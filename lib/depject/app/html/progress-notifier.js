const { computed, when, h, Value } = require('mutant')
const nest = require('depnest')
const sustained = require('../../../sustained')
const pull = require('pull-stream')

exports.gives = nest('app.html.progressNotifier')

exports.needs = nest({
  'sbot.pull.stream': 'first',
  'progress.obs': {
    indexes: 'first',
    replicate: 'first',
    migration: 'first'
  },
  'intl.sync.i18n': 'first'
})

exports.create = function (api) {
  const i18n = api.intl.sync.i18n
  return nest('app.html.progressNotifier', function () {
    const replicateProgress = api.progress.obs.replicate()
    const indexes = api.progress.obs.indexes()
    const migration = api.progress.obs.migration()
    const waiting = Waiting(replicateProgress)

    const pending = computed(indexes, (progress) => progress.target - progress.current || 0)
    const pendingMigration = computed(migration, (progress) => progress.target - progress.current || 0)

    const indexProgress = computed(indexes, calcProgress)
    const migrationProgress = computed(migration, calcProgress)

    let incompleteFeedsFrom = 0

    const downloadProgress = computed([replicateProgress.feeds, replicateProgress.incompleteFeeds], (feeds, incomplete) => {
      if (incomplete > incompleteFeedsFrom) {
        incompleteFeedsFrom = incomplete
      } else if (incomplete === 0) {
        incompleteFeedsFrom = 0
      }
      if (feeds && incomplete) {
        return clamp((feeds - incomplete) / incompleteFeedsFrom)
      } else {
        return 1
      }
    })

    const hidden = sustained(computed([waiting, downloadProgress, pending, pendingMigration], (waiting, downloadProgress, pending, pendingMigration) => {
      return !waiting && downloadProgress === 1 && !pending && !pendingMigration
    }), 500)

    // HACK: css animations take up WAY TO MUCH cpu, remove from dom when inactive
    const displaying = computed(sustained(hidden, 500, x => !x), hidden => !hidden)

    // HACK: Resolves an issue where buttons are non-responsive while indexing.
    //
    // 1. Sets the *progress* cursor when Patchwork is focused.
    // 2. Sets the *wait* cursor when a publish button is selected.
    // 3. Sets the *not-allowed* cursor when a publish button is activated.
    //
    // If a user disregards all of the above then `modules/sbot.js` will return
    // an error telling the user to wait until indexing is finished.
    const readOnlyMode = `
      body {
        cursor: progress;
      }

      button:not(.-clear):not(.-cancel):not(.cancel), .like, .reply, .tag, .ToggleButton, .Picker {
        cursor: wait;
        opacity: 0.5;
      }

      button:not(.-clear):not(.-cancel):not(.cancel):active, .like:active, .reply:active, .tag:active, .ToggleButton:active, .Picker:active {
        cursor: not-allowed;
      }
    `

    return h('div.info', { hidden }, [
      h('div.status', [
        when(displaying, h('Loading -small', [
          when(pendingMigration,
            [h('span.info', i18n('Upgrading database')), h('progress', { style: { 'margin-left': '10px' }, min: 0, max: 1, value: migrationProgress })],
            when(computed(downloadProgress, (v) => v < 1),
              [h('span.info', i18n('Downloading new messages')), h('progress', { style: { 'margin-left': '10px' }, min: 0, max: 1, value: downloadProgress })],
              when(pending, [
                [
                  h('span.info', i18n('Indexing database')),
                  h('progress', { style: { 'margin-left': '10px' }, min: 0, max: 1, value: indexProgress }),
                  h('style', readOnlyMode)
                ]
              ], i18n('Scuttling...'))
            )
          )
        ]))
      ])
    ])
  })

  // scoped

  function Waiting (progress) {
    const waiting = Value()
    let lastTick = Date.now()

    progress && progress(update)

    pull(
      api.sbot.pull.stream(sbot => sbot.patchwork.heartbeat()),
      pull.drain(update)
    )

    setInterval(function () {
      if (lastTick < Date.now() - 1000) {
        waiting.set(true)
      }
    }, 1000)

    return waiting

    // scoped

    function update () {
      lastTick = Date.now()
      waiting.set(false)
    }
  }
}

function clamp (value) {
  return Math.min(1, Math.max(0, value)) || 0
}

function calcProgress (progress) {
  const range = progress.target - progress.start
  if (range) {
    return (progress.current - progress.start) / range
  } else {
    return 1
  }
}
