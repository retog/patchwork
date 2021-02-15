const nest = require('depnest')
const { Value, Proxy, Array: MutantArray, h, computed, when, throttle, isObservable, resolve } = require('mutant')
const pull = require('pull-stream')
const Abortable = require('pull-abortable')
const Scroller = require('../../../scroller')
const extend = require('xtend')
const GroupSummaries = require('../../../group-summaries')
const rootBumpTypes = ['mention', 'channel-mention', 'invite']
const getBump = require('../../../get-bump')
const many = require('../../../many')
const channelLink = require('../../../channel/html/link.js')
const getRoot = require('../../../message/sync/root')

const bumpMessages = {
  reaction: 'liked this message',
  invite: 'invited you to this gathering',
  reply: 'replied to this message',
  updated: 'added changes',
  mention: 'mentioned you',
  'channel-mention': 'mentioned this channel',
  attending: 'can attend'
}

exports.needs = nest({
  'message.html.canRender': 'first',
  'message.html.render': 'first',
  'profile.html.person': 'first',
  'keys.sync.id': 'first',
  'intl.sync.i18n': 'first',
  'intl.sync.i18n_n': 'first',
  'message.html.missing': 'first',
  'feed.html.metaSummary': 'first'
})

exports.gives = nest({
  'feed.html.rollup': true
})

exports.create = function (api) {
  const i18n = api.intl.sync.i18n
  const i18nPlural = api.intl.sync.i18n_n
  return nest('feed.html.rollup', function (getStream, {
    prepend,
    hidden = false,
    groupSummaries = true,
    compactFilter = returnFalse,
    ungroupFilter = returnFalse,
    searchSpinner = false,
    updateStream
  }) {
    const updates = Value(0)
    const yourId = api.keys.sync.id()
    const throttledUpdates = throttle(updates, 200)
    const updateLoader = h('a Notifier -loader', { href: '#', 'ev-click': refresh }, [
      'Show ', h('strong', [throttledUpdates]), ' ', plural(throttledUpdates, i18n('update'), i18n('updates'))
    ])

    let abortLastFeed = null
    let unwatchHidden = null
    const content = Value()
    const loading = Proxy(true)
    const unreadIds = new Set()
    let newSinceRefresh = new Set()
    let highlightItems = new Set()

    const container = h('Scroller', {
      // only bind elements that are visible in scroller
      intersectionBindingViewport: { rootMargin: '1000px' },

      style: { overflow: 'auto' },
      hooks: [() => {
        // don't activate until added to DOM
        refresh()

        if (isObservable(hidden)) {
          unwatchHidden = hidden(() => {
            refresh()
          })
        }

        // deactivate when removed from DOM
        return () => {
          if (abortLastFeed) {
            abortLastFeed()
            abortLastFeed = null
          }

          if (unwatchHidden) {
            unwatchHidden()
            unwatchHidden = null
          }
        }
      }]
    }, [
      h('div.wrapper', [
        h('section.prepend', prepend),
        content,
        when(loading, searchSpinner ? h('Loading -large -search') : h('Loading -large'))
      ])
    ])

    if (updateStream) {
      pull(
        updateStream,
        pull.drain((msg) => {
          if (!(msg && msg.value && msg.value.content && msg.value.content.type)) return
          if (!canRenderMessage(msg)) return

          // Only increment the 'new since' for items that we render on
          // the feed as otherwise the 'show <n> updates message' will be
          // shown on new messages that patchwork cannot render
          if (msg.value.author !== yourId && (!msg.root || canRenderMessage(msg.root))) {
            newSinceRefresh.add(msg.key)
            unreadIds.add(msg.key)
          }

          if (msg.value.author === yourId && content()) {
            // dynamically insert this post into the feed! (manually so that it doesn't get slow with mutant)
            if (getRoot(msg)) {
              const existingContainer = content().querySelector(`[data-root-id="${getRoot(msg)}"]`)
              if (existingContainer) {
                const replies = existingContainer.querySelector('div.replies')
                replies.appendChild(api.message.html.render(msg, {
                  compact: false,
                  priority: 2
                }))
              }
            } else {
              highlightItems.add(msg.key)
              content().prepend(
                renderItem(extend(msg, {
                  latestReplies: [],
                  totalReplies: 0,
                  rootBump: { type: 'post' }
                }))
              )
            }
          }

          updates.set(newSinceRefresh.size)
        })
      )
    }

    const result = MutantArray([
      when(hidden,
        null,
        when(updates, updateLoader)
      ),
      container
    ])

    result.pendingUpdates = throttledUpdates
    result.reload = refresh

    return result

    function canRenderMessage (msg) {
      if (msg && msg.value && msg.value.content) {
        return api.message.html.canRender(msg)
      }
    }

    function refresh () {
      if (resolve(hidden)) {
        content.set(null)
        loading.set(false)
        return
      }
      if (abortLastFeed) abortLastFeed()
      updates.set(0)
      content.set(h('section.content'))

      const abortable = Abortable()
      abortLastFeed = abortable.abort

      highlightItems = newSinceRefresh
      newSinceRefresh = new Set()

      const firstItemVisible = Value(false)

      const done = Value(false)
      const scroller = Scroller(container, content(), renderItem, {
        onDone: () => done.set(true),
        onItemVisible: (item) => {
          if (!firstItemVisible()) {
            firstItemVisible.set(true)
          }
          if (Array.isArray(item.msgIds)) {
            item.msgIds.forEach(id => {
              unreadIds.delete(id)
            })
          }
        }
      })

      // track loading state
      loading.set(scroller.waiting)

      const seen = new Set()

      pull(
        getStream(),
        abortable,
        pull.filter(item => {
          // don't show the same threads again (repeats due to pull-resume)
          if (seen.has(item.key)) {
            return false
          }
          seen.add(item.key)
          return true
        }),
        pull.filter(canRenderMessage),

        // group related items (follows, subscribes, abouts)
        groupSummaries ? GroupSummaries({ windowSize: 15, getPriority, ungroupFilter }) : pull.through(),

        scroller
      )
    }

    function renderItem (item, opts) {
      if (item.group) {
        return api.feed.html.metaSummary(item, renderItem, getPriority, opts)
      }

      let mostRecentBumpType = (item.bumps && item.bumps[0] && item.bumps[0].type)

      const rootBump = getBump(item, item.rootBump)
      if (!mostRecentBumpType) {
        if (rootBump && rootBumpTypes.includes(rootBump.type)) {
          mostRecentBumpType = rootBump.type
        } else {
          mostRecentBumpType = 'reply'
        }
      }

      const bumps = getBumps(item)[mostRecentBumpType]

      const renderedMessage = api.message.html.render(item, {
        compact: compactFilter(item),
        includeForks: false,
        pageId: item.key,
        forkedFrom: item.value.content.root,
        priority: getPriority(item)
      })

      const unreadBumps = []
      if (!highlightItems.has(item.key) && item.bumps) {
        item.bumps.forEach(bump => {
          if (highlightItems.has(bump.id)) {
            unreadBumps.push(bump.id)
          }
        })
      }

      unreadIds.delete(item.key)

      let meta = null

      // explain why this message is in your feed
      if (mostRecentBumpType !== 'matches-channel' && item.rootBump && item.rootBump.type === 'matches-channel') {
        // the root post was in a channel that you subscribe to
        meta = h('div.meta', [
          many(item.rootBump.channels, channelLink, i18n), ' ', i18n('mentioned in your network')
        ])
      } else if (bumps && bumps.length) {
        const authors = getAuthors(bumps)
        if (mostRecentBumpType === 'matches-channel') {
          // a reply to this post matches a channel you subscribe to
          const channels = new Set()
          bumps.forEach(bump => bump.channels && bump.channels.forEach(c => channels.add(c)))
          meta = h('div.meta', [
            i18nPlural('%s people from your network replied to this message on ', authors.length),
            many(channels, channelLink, i18n)
          ])
        } else {
          // someone you follow replied to this message
          const description = i18n(bumpMessages[mostRecentBumpType] || 'added changes')
          meta = h('div.meta', [
            many(authors, api.profile.html.person, i18n), ' ', description
          ])
        }
      }

      const latestReplyIds = item.latestReplies.map(msg => msg.key)
      const hasMoreNewReplies = unreadBumps.some(id => !latestReplyIds.includes(id))

      return h('FeedEvent -post', {
        msgIds: [item.key].concat(item.latestReplies.map(x => x.key)),
        attributes: {
          'data-root-id': item.key
        }
      }, [
        meta,
        renderedMessage,
        item.totalReplies > item.latestReplies.length
          ? h('a.full',
              {
                href: item.key,
                anchor: {
                // highlight unread messages in thread view
                  unread: unreadBumps,
                  // only drop to latest messages if there are more new messages not visible in thread summary
                  anchor: hasMoreNewReplies ? unreadBumps[unreadBumps.length - 1] : null
                }
              }, [i18n('View full thread') + ' (', item.totalReplies, ')'])
          : null,
        h('div.replies', [
          item.latestReplies.map(msg => {
            const result = api.message.html.render(msg, {
              compact: compactFilter(msg, item),
              priority: getPriority(msg)
            })

            return [
              // insert missing message marker (if can't be found)
              api.message.html.missing(last(msg.value.content.branch), msg, item),
              result
            ]
          })
        ])
      ])
    }

    function getPriority (msg) {
      if (highlightItems.has(msg.key)) {
        return 2
      } else if (unreadIds.has(msg.key)) {
        return 1
      } else {
        return 0
      }
    }
  })
}

function plural (value, single, many) {
  return computed(value, (value) => {
    if (value === 1) {
      return single
    } else {
      return many
    }
  })
}

function getAuthors (items) {
  const authors = {}
  items.forEach(item => {
    authors[item.author] = true
  })
  return Object.keys(authors)
}

function returnFalse () {
  return false
}

function last (array) {
  if (Array.isArray(array)) {
    return array[array.length - 1]
  } else {
    return array
  }
}

function getBumps (msg) {
  const bumps = {}
  const rootBump = getBump(msg, msg.rootBump)

  if (rootBump) {
    bumps[rootBump.type] = [rootBump]
  }

  if (Array.isArray(msg.bumps)) {
    msg.bumps.forEach(bump => {
      const type = bump.type || 'reply'
      bumps[type] = bumps[type] || []
      bumps[type].push(bump)
    })
  }
  return bumps
}
