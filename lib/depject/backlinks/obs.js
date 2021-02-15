const nest = require('depnest')
const Value = require('mutant/value')
const onceTrue = require('mutant/once-true')
const computed = require('mutant/computed')
const resolve = require('mutant/resolve')
const pull = require('pull-stream')
const sorted = require('sorted-array-functions')
const MutantPullCollection = require('../../mutant-pull-collection')
const getTimestamp = require('../../get-timestamp')
const getRoot = require('../../message/sync/root')

exports.needs = nest({
  'sbot.pull.backlinks': 'first',
  'sbot.obs.connection': 'first',
  'sbot.pull.stream': 'first'
})

exports.gives = nest({
  'backlinks.obs.for': true,
  'backlinks.obs.references': true,
  'backlinks.obs.forks': true
})

exports.create = function (api) {
  const cache = {}
  const collections = {}

  let loaded = false

  // cycle remove sets for fast cleanup
  let newRemove = new Set()
  let oldRemove = new Set()

  // run cache cleanup every 5 seconds
  // an item will be removed from cache between 5 - 10 seconds after release
  // this ensures that the data is still available for a page reload
  const timer = setInterval(() => {
    oldRemove.forEach(id => {
      if (cache[id]) {
        unsubscribe(id)
        delete collections[id]
        delete cache[id]
      }
    })
    oldRemove.clear()

    // cycle
    const hold = oldRemove
    oldRemove = newRemove
    newRemove = hold
  }, 5e3)

  if (timer.unref) timer.unref()

  return nest({
    'backlinks.obs.for': (id) => backlinks(id),
    'backlinks.obs.references': references,
    'backlinks.obs.forks': forks
  })

  function references (msg) {
    const id = msg.key
    return MutantPullCollection((lastMessage) => {
      return api.sbot.pull.stream((sbot) => sbot.patchwork.backlinks.referencesStream({ id, since: lastMessage && lastMessage.timestamp }))
    })
  }

  function forks (msg) {
    const id = msg.key
    const rooted = !!getRoot(msg)
    if (rooted) {
      return MutantPullCollection((lastMessage) => {
        return api.sbot.pull.stream((sbot) => sbot.patchwork.backlinks.forksStream({ id, since: lastMessage && lastMessage.timestamp }))
      })
    } else {
      return []
    }
  }

  function backlinks (id) {
    load()
    if (!cache[id]) {
      const sync = Value(false)
      const collection = Value([])
      subscribe(id)

      process.nextTick(() => {
        pull(
          api.sbot.pull.backlinks({
            query: [{ $filter: { dest: id } }],
            index: 'DTA' // use asserted timestamps
          }),
          pull.drain((msg) => {
            const value = resolve(collection)
            sorted.add(value, msg, compareAsserted)
            collection.set(value)
          }, () => {
            sync.set(true)
          })
        )
      })

      collections[id] = collection
      cache[id] = computed([collection], x => x, {
        onListen: () => use(id),
        onUnlisten: () => release(id)
      })

      cache[id].sync = sync
    }
    return cache[id]
  }

  function load () {
    if (!loaded) {
      pull(
        api.sbot.pull.stream(sbot => sbot.patchwork.liveBacklinks.stream()),
        pull.drain(msg => {
          const collection = collections[msg.dest]
          if (collection) {
            const value = resolve(collection)
            sorted.add(value, msg, compareAsserted)
            collection.set(value)
          }
        })
      )
      loaded = true
    }
  }

  function use (id) {
    newRemove.delete(id)
    oldRemove.delete(id)
  }

  function release (id) {
    newRemove.add(id)
  }

  function subscribe (id) {
    onceTrue(api.sbot.obs.connection(), (sbot) => sbot.patchwork.liveBacklinks.subscribe(id))
  }

  function unsubscribe (id) {
    onceTrue(api.sbot.obs.connection(), (sbot) => sbot.patchwork.liveBacklinks.unsubscribe(id))
  }

  function compareAsserted (a, b) {
    if (isReplyTo(a, b)) {
      return -1
    } else if (isReplyTo(b, a)) {
      return 1
    } else {
      return getTimestamp(a) - getTimestamp(b)
    }
  }
}

function isReplyTo (maybeReply, msg) {
  return (includesOrEquals(maybeReply.branch, msg.key))
}

function includesOrEquals (array, value) {
  if (Array.isArray(array)) {
    return array.includes(value)
  } else {
    return array === value
  }
}
