const h = require('mutant/h')
const nest = require('depnest')
const extend = require('xtend')
const addContextMenu = require('../../../../message/html/decorate/context-menu')

exports.needs = nest({
  'message.html': {
    layout: 'first',
    markdown: 'first'
  }
})

exports.gives = nest({
  'message.html': {
    canRender: true,
    render: true
  }
})

exports.create = function (api) {
  return nest('message.html', {
    canRender: isRenderable,
    render: function (msg, opts) {
      if (!isRenderable(msg)) return
      const element = api.message.html.layout(msg, extend({
        content: messageContent(msg),
        layout: 'default'
      }, opts))

      return addContextMenu(element, {
        msg
      })
    }
  })

  function messageContent (data) {
    if (!data.value.content || !data.value.content.text) return
    return h('div', {}, api.message.html.markdown(data.value.content))
  }

  function isRenderable (msg) {
    return msg.value.content.type === 'issue' ? true : undefined
  }
}
