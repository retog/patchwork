const nest = require('depnest')
const ref = require('ssb-ref')
const { h, computed } = require('mutant')
const many = require('../../../many')

exports.needs = nest({
  'backlinks.obs.forks': 'first',
  'message.obs': {
    name: 'first'
  },
  'profile.html.person': 'first',
  'intl.sync.i18n': 'first'
})

exports.gives = nest('message.html.forks')

exports.create = function (api) {
  const i18n = api.intl.sync.i18n
  return nest('message.html.forks', function (msg) {
    if (!ref.type(msg.key)) return []

    const forks = api.backlinks.obs.forks(msg)

    return [
      computed(forks, links => {
        if (links && links.length) {
          const authors = new Set(links.map(link => link.author))
          return h('a.backlink', {
            href: msg.key,
            anchor: links[0].id
          }, [
            h('strong', [
              many(authors, api.profile.html.person, i18n), i18n(' forked this discussion:')
            ]), ' ',
            api.message.obs.name(links[0].id),
            ' (', links.length, ')'
          ])
        }
      }, { idle: true })
    ]
  })
}
