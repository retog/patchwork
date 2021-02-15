const { h, map, computed, Value, lookup: mutantLookup } = require('mutant')
const nest = require('depnest')

exports.needs = nest({
  'about.obs.name': 'first',
  'intl.sync.i18n': 'first'
})

exports.gives = nest('sheet.tags.renderTags')

exports.create = function (api) {
  const i18n = api.intl.sync.i18n
  return nest('sheet.tags.renderTags', function (ids, select) {
    const currentFilter = Value()
    const tagLookup = mutantLookup(ids, (id) => {
      return [id, api.about.obs.name(id)]
    })
    const filteredIds = computed([ids, tagLookup, currentFilter], (ids, lookup, filter) => {
      if (!filter) return ids
      const result = []
      for (const k in lookup) {
        if ((lookup[k] && lookup[k].toLowerCase().includes(filter.toLowerCase())) ||
          k === filter) {
          result.push(k)
        }
      }
      return result
    })
    return h('TagSheet', [
      h('h2', [
        i18n('Applied Tags'),
        h('input', {
          type: 'search',
          placeholder: 'filter tags',
          'ev-input': ev => currentFilter.set(ev.target.value),
          hooks: [FocusHook()]
        })
      ]),
      renderTagList(filteredIds, select)
    ])
  })

  function renderTagList (tags, select) {
    return [
      h('TagList', [
        map(tags, (id) => {
          return h('a.tag',
            { href: `/tags/${encodeURIComponent(id)}/all`, title: id },
            [
              h('div.main', [
                h('div.name', [api.about.obs.name(id)])
              ]),
              h('div.buttons', [
                h('a.ToggleButton', { 'ev-click': () => select(id) }, i18n('View Taggers'))
              ])
            ])
        }, { nextTick: true, maxTime: 2 })
      ])
    ]
  }
}

function FocusHook () {
  return function (element) {
    setTimeout(() => {
      element.focus()
      element.select()
    }, 5)
  }
}
