const { h, computed, Value, when } = require('mutant')
const nest = require('depnest')
const ref = require('ssb-ref')
const ExpanderHook = require('../../../../expander-hook')
const timestamp = require('../../../../message/html/timestamp')

exports.needs = nest({
  'profile.html.person': 'first',
  'contact.obs.following': 'first',
  'keys.sync.id': 'first',
  'message.html': {
    link: 'first',
    metas: 'first',
    actions: 'first',
    references: 'first',
    forks: 'first'
  },
  'about.html.image': 'first',
  'intl.sync.i18n': 'first'
})

exports.gives = nest('message.html.layout')

exports.create = function (api) {
  const i18n = api.intl.sync.i18n
  let yourFollows = null

  // to get sync follows
  setImmediate(() => {
    const yourId = api.keys.sync.id()
    yourFollows = api.contact.obs.following(yourId)
  })

  return nest('message.html.layout', layout)

  function layout (msg, { layout, priority, content, includeReferences = false, includeForks = true, compact = false, hooks, forkedFrom, outOfContext }) {
    if (!(layout === undefined || layout === 'default')) return

    const classList = ['Message']
    let replyInfo = null

    const needsExpand = Value(false)
    const expanded = Value(false)

    // new message previews shouldn't contract
    if (!msg.key) expanded.set(true)

    if (msg.value.content.root) {
      classList.push('-reply')
      if (forkedFrom) {
        replyInfo = h('span', [i18n('forked from parent thread '), api.message.html.link(forkedFrom)])
      } else if (outOfContext) {
        replyInfo = h('span', [i18n('in reply to '), api.message.html.link(msg.value.content.root)])
      }
    } else if (msg.value.content.project) {
      replyInfo = h('span', [i18n('on '), api.message.html.link(msg.value.content.project)])
    }

    if (yourFollows && yourFollows().includes(msg.value.author)) {
      classList.push('-following')
    }

    if (compact) {
      classList.push('-compact')
    }

    if (priority === 2) {
      classList.push('-new')
    }

    if (priority === 1) {
      classList.push('-unread')
    }

    let cw = msg.value.content.contentWarning
    if (typeof cw !== 'string' || cw.length === 0) {
      cw = undefined
    } else {
      // TODO: emoji shortcodes?
      // TODO: truncate very long content warning, maybe use max-height?
      classList.push('-hasContentWarning')
    }

    return h('div', {
      classList,
      hooks
    }, [
      messageHeader(msg, { replyInfo, priority }),
      cw
        ? h('a.contentWarning',
            {
              href: '#',
              'ev-click': toggleAndTrack(expanded)
            },
            cw
          )
        : undefined,
      h('section.content', {
        classList: [when(expanded, '-expanded')],
        hooks: [ExpanderHook(needsExpand)]
      }, content),
      computed(msg.key, (key) => {
        if (ref.isMsg(key)) {
          return h('footer', [
            when(needsExpand, h('div.expander', {
              classList: when(expanded, null, '-truncated')
            }, [
              h('a', {
                href: '#',
                'ev-click': toggleAndTrack(expanded)
              }, when(expanded, i18n('See less'), i18n('See more')))
            ])),
            h('div.actions', [
              api.message.html.actions(msg)
            ])
          ])
        }
      }),
      includeReferences ? api.message.html.references(msg) : null,
      includeForks ? api.message.html.forks(msg) : null
    ])

    // scoped

    function messageHeader (msg, { replyInfo, priority }) {
      const yourId = api.keys.sync.id()
      const additionalMeta = []
      if (priority === 2) {
        additionalMeta.push(h('span.flag -new', { title: i18n('New Message') }))
      } else if (priority === 1) {
        additionalMeta.push(h('span.flag -unread', { title: i18n('Unread Message') }))
      }

      return h('header', [
        h('div.main', [
          h('a.avatar', { href: `${msg.value.author}` }, [
            api.about.html.image(msg.value.author)
          ]),
          h('div.main', [
            h('div.name', [
              api.profile.html.person(msg.value.author),
              msg.value.author === yourId ? [' ', h('span.you', {}, i18n('(you)'))] : null
            ]),
            h('div.meta', [
              timestamp(msg), ' ',
              replyInfo
            ])
          ])
        ]),
        h('div.meta', [
          additionalMeta,
          api.message.html.metas(msg)
        ])
      ])
    }
  }
}

function toggleAndTrack (param) {
  return {
    handleEvent: handleToggle,
    param
  }
}

function handleToggle (ev) {
  this.param.set(!this.param())
  if (!this.param()) {
    ev.target.scrollIntoViewIfNeeded()

    // HACK: due to a browser bug, sometimes the body gets affected!?
    // Why not just hack it!!!
    if (document.body.scrollTop > 0) {
      document.body.scrollTop = 0
    }
  }
}
