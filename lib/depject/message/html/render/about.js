const h = require('mutant/h')
const computed = require('mutant/computed')
const nest = require('depnest')
const extend = require('xtend')
const ref = require('ssb-ref')
const addContextMenu = require('../../../../message/html/decorate/context-menu')

exports.needs = nest({
  'message.html': {
    layout: 'first',
    markdown: 'first'
  },
  'profile.html.person': 'first',
  'about.obs.name': 'first',
  'blob.sync.url': 'first',
  'intl.sync.i18n': 'first'
})

exports.gives = nest('message.html', {
  canRender: true,
  render: true
})

exports.create = function (api) {
  const i18n = api.intl.sync.i18n
  return nest('message.html', {
    canRender: isRenderable,
    render: function (msg, opts) {
      if (!isRenderable(msg)) return

      const c = msg.value.content
      const self = msg.value.author === c.about

      const miniContent = []
      const content = []

      if (c.name) {
        const target = api.profile.html.person(c.about, c.name)
        miniContent.push(computed([self, api.about.obs.name(c.about), c.name], (self, a, b) => {
          if (self) {
            return [i18n('self identifies as '), '"', target, '"']
          } else if (a === b) {
            return [i18n('identified '), api.profile.html.person(c.about)]
          } else {
            return [i18n('identifies '), api.profile.html.person(c.about), i18n(' as "'), target, '"']
          }
        }))
      }

      if (c.image) {
        if (!miniContent.length) {
          const imageAction = self ? i18n('self assigned a display image') : [i18n('assigned a display image to '), api.profile.html.person(c.about)]
          miniContent.push(imageAction)
        }

        content.push(h('a AboutImage', {
          href: c.about
        }, [
          h('img', { src: api.blob.sync.url(c.image) })
        ]))
      }

      const elements = []

      if (miniContent.length) {
        const element = api.message.html.layout(msg, extend({
          showActions: true,
          miniContent,
          content,
          layout: 'mini'
        }, opts))
        elements.push(addContextMenu(element, { msg }))
      }

      if (c.description) {
        elements.push(addContextMenu(api.message.html.layout(msg, extend({
          showActions: true,
          miniContent: self ? i18n('self assigned a description') : [i18n('assigned a description to '), api.profile.html.person(c.about)],
          content: api.message.html.markdown(c.description),
          layout: 'mini'
        }, opts)), { msg }))
      }

      return elements
    }
  })

  function isRenderable (msg) {
    if (msg.value.content.type !== 'about') return
    if (!ref.isFeed(msg.value.content.about)) return
    const c = msg.value.content
    if (!c || (!c.description && !isBlobLink(c.image) && !c.name)) return
    return true
  }
}

function isBlobLink (link) {
  if (link && typeof link.link === 'string') {
    link = link.link
  }
  const parsed = ref.parseLink(link)
  if (parsed && ref.isBlob(parsed.link)) {
    return true
  }
}
