const nest = require('depnest')
const { h } = require('mutant')

exports.needs = nest({
  'sbot.pull.resumeStream': 'first',
  'sbot.pull.stream': 'first',
  'message.html.compose': 'first',
  'feed.html.rollup': 'first',
  'intl.sync.i18n': 'first'
})

exports.gives = nest({
  'page.html.render': true
})

exports.create = function (api) {
  const i18n = api.intl.sync.i18n
  return nest('page.html.render', page)

  function page (path) {
    if (path !== '/all') return // "/" is a sigil for "page"

    const prepend = [
      h('PageHeading', [
        h('h1', [
          i18n('All Posts from Your '),
          h('strong', i18n('Extended Network'))
        ])
      ]),
      api.message.html.compose({ meta: { type: 'post' }, placeholder: i18n('Write a public message') })
    ]

    const getStream = api.sbot.pull.resumeStream((sbot, opts) => {
      return sbot.patchwork.networkFeed.roots(opts)
    }, { limit: 40, reverse: true })

    const feedView = api.feed.html.rollup(getStream, {
      prepend,
      updateStream: api.sbot.pull.stream(sbot => sbot.patchwork.networkFeed.latest())
    })

    const result = h('div.SplitView', [
      h('div.main', feedView)
    ])

    result.pendingUpdates = feedView.pendingUpdates
    result.reload = feedView.reload

    return result
  }
}
