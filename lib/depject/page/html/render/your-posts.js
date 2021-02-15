const nest = require('depnest')
const { h } = require('mutant')

exports.needs = nest({
  'sbot.pull.resumeStream': 'first',
  'sbot.pull.stream': 'first',
  'feed.html.rollup': 'first',
  'keys.sync.id': 'first',
  'intl.sync.i18n': 'first'
})

exports.gives = nest({
  'page.html.render': true
})

exports.create = function (api) {
  const i18n = api.intl.sync.i18n
  return nest('page.html.render', page)

  function page (path) {
    if (path !== '/your-posts') return // "/" is a sigil for "page"

    const prepend = [
      h('PageHeading', [
        h('h1', [
          i18n('Threads Started By You')
        ])
      ])
    ]

    const getStream = api.sbot.pull.resumeStream((sbot, opts) => {
      return sbot.patchwork.participatingFeed.roots(opts)
    }, { limit: 10, reverse: true, onlyStarted: true })

    const yourId = api.keys.sync.id()

    const feedView = api.feed.html.rollup(getStream, {
      prepend,
      searchSpinner: true,
      groupSummaries: false,
      compactFilter: (msg) => msg.value.author === yourId, // condense your messages
      updateStream: api.sbot.pull.stream(sbot => sbot.patchwork.participatingFeed.latest({ onlyStarted: true }))
    })

    const result = h('div.SplitView', [
      h('div.main', feedView)
    ])

    result.pendingUpdates = feedView.pendingUpdates
    result.reload = feedView.reload

    return result
  }
}
