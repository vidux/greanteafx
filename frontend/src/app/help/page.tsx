import type { Metadata } from 'next';
import Link from 'next/link';

import { Brand } from '@/components/Brand';

export const metadata: Metadata = {
  title: 'Help & Guide — GreanTeaFX',
  description:
    'How to place sound sources in 3D, automate their motion, edit clips on the timeline and render a spatial mixdown in GreanTeaFX.',
};

const SECTIONS = [
  { id: 'quick-start', title: 'Quick start' },
  { id: 'layout', title: 'The screen at a glance' },
  { id: 'tracks', title: 'Tracks' },
  { id: 'positioning', title: 'Placing sounds in 3D' },
  { id: 'paths', title: 'Motion paths' },
  { id: 'timeline', title: 'Editing on the timeline' },
  { id: 'transport', title: 'Playback and project length' },
  { id: 'tempo', title: 'Tempo' },
  { id: 'projects', title: 'Saving and opening projects' },
  { id: 'mixdown', title: 'Exporting the mix' },
  { id: 'shortcuts', title: 'Keyboard shortcuts' },
  { id: 'troubleshooting', title: 'Troubleshooting' },
  { id: 'glossary', title: 'Glossary' },
] as const;

const SHORTCUTS: ReadonlyArray<readonly [keys: string[], action: string]> = [
  [['Space'], 'Play / stop'],
  [['V'], 'Select tool'],
  [['M'], 'Move tool'],
  [['Alt', 'drag'], 'Use the other tool for one drag'],
  [['Ctrl', 'C'], 'Copy the selection'],
  [['Ctrl', 'X'], 'Cut the selection'],
  [['Ctrl', 'V'], 'Paste into the selected track'],
  [['S'], 'Split the clip under the playhead on the selected track'],
  [['Delete'], 'Delete the selection (Backspace works too)'],
  [['Ctrl', 'D'], 'Duplicate the selected track onto a free channel'],
  [['Esc'], 'Clear the selection and stop adding keyframes'],
  [['Shift', 'scroll'], 'Zoom the cube or the 3D view (pointer over it)'],
  [['Shift', 'drag'], 'Pan the 3D view (right-drag works too)'],
  [['?'], 'Show the quick guide'],
  [['Home'], 'Playhead to the start (ruler focused)'],
  [['End'], 'Playhead to the end (ruler focused)'],
];

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="help-keys">
      {keys.map((k, i) => (
        <span key={k}>
          {i > 0 && <span className="help-plus">+</span>}
          <kbd>{k}</kbd>
        </span>
      ))}
    </span>
  );
}

export default function HelpPage() {
  return (
    <div className="help-page">
      <header className="help-header">
        <Brand subtitle="Help & guide" heading />
        <Link href="/" className="help-back">
          ← Back to the console
        </Link>
      </header>

      <div className="help-layout">
        <nav className="help-toc" aria-label="Guide contents">
          <p className="help-toc-title">Contents</p>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="help-content">
          <p className="help-lede">
            GreanTeaFX places sounds around a listener in 3D space. You put each sound somewhere in a
            cube, or send it along a path. You arrange the audio on a timeline, hear it live
            with HRTF spatialisation, and download the finished stereo mix as a WAV file.
          </p>
          <p className="help-callout">
            <b>Wear headphones.</b> The spatial effect comes from HRTF filtering, which models
            how sound reaches each ear. On speakers it collapses to ordinary left/right panning.
          </p>

          <section id="quick-start">
            <h2>1. Quick start</h2>
            <ol className="help-steps">
              <li>
                Drop an audio file (MP3, WAV, FLAC or OGG, up to 64 MB) on a track&apos;s lane, or
                use the upload button beside the track&apos;s name. The sample loops across the
                whole project.
              </li>
              <li>
                Press the <b>play</b> button (or <kbd>Space</kbd>) to start playback.
              </li>
              <li>
                Drag the track&apos;s coloured dot in the cube. You hear the sound move around
                you as you drag.
              </li>
              <li>
                Switch the cube to <b>Front</b>, <b>Top</b> or <b>Side</b> to look at it from
                another angle and set the third axis, or use the sliders beside the cube.
              </li>
              <li>
                Press <b>Export mix (WAV)</b> to render the finished spatial mix.
              </li>
            </ol>
            <p>
              The <b>?</b> button in the top bar (or the <kbd>?</kbd> key) shows these steps
              without leaving the console.
            </p>
          </section>

          <section id="layout">
            <h2>2. The screen at a glance</h2>
            <dl className="help-defs">
              <dt>Top bar</dt>
              <dd>
                <b>Open</b> and <b>Save</b> for project files, <b>?</b> for the quick guide, and{' '}
                <b>Export mix (WAV)</b>. Beside or below them, the transport: back to start,
                play/pause, stop, the playhead clock, project <b>Length</b> and <b>Master</b>{' '}
                volume.
              </dd>
              <dt>Cube</dt>
              <dd>
                The room, seen flat from one of three views or freely in <b>3D</b>. You sit at
                the centre (<b>YOU</b>). Each active track is a coloured dot, named beside it with
                its position on the hidden axis (in 3D, its distance from you). Grid squares are 1
                metre. Hold <kbd>Shift</kbd> and scroll over it to zoom.
              </dd>
              <dt>Inspector</dt>
              <dd>
                The panel beside the cube. It shows the selected track: its position sliders, how
                it moves, and its tempo. Click a track&apos;s name or its dot to select it.
              </dd>
              <dt>Tracks bar</dt>
              <dd>
                The Select/Move tool switch, a readout of the current selection and clipboard,
                the <b>Copy</b>, <b>Cut</b>, <b>Paste</b>, <b>Split</b> and <b>Delete</b> buttons,
                and <b>+ Add track</b>.
              </dd>
              <dt>Timeline</dt>
              <dd>
                A ruler you can scrub, then one row per active track. The left side of a row
                holds its controls; the right side holds its clips, drawn as waveforms.
              </dd>
              <dt>Status bar</dt>
              <dd>
                The bottom line. It says whether playback is running and what the project still
                needs, then what just happened, for example{' '}
                <code>Pasted 2.00s into CH02 at 4.00s</code> or an error message.
              </dd>
            </dl>
          </section>

          <section id="tracks">
            <h2>3. Tracks</h2>
            <p>
              There are ten channels. Four start active. <b>+ Add track</b> switches on the next
              free one. Click a track&apos;s name to select it; the inspector beside the cube
              then shows it.
            </p>
            <table className="help-table">
              <thead>
                <tr>
                  <th scope="col">Control</th>
                  <th scope="col">What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>Lane</b> / <b>upload icon</b>
                  </td>
                  <td>
                    Loads a sample: drop a file on the lane, or use the upload icon beside the
                    track&apos;s name. The lane is reset to a single clip
                    that loops the sample across the whole project. Loading onto a lane that
                    already has audio replaces it and discards its previous clips.
                  </td>
                </tr>
                <tr>
                  <td>
                    <b>Eye</b>
                  </td>
                  <td>
                    Shows or hides the track&apos;s dot and path in the cube. A hidden track keeps
                    playing. Use it when dots overlap and the one you want is underneath. The cube
                    lists hidden tracks and offers <b>Show all</b>, and a hidden track&apos;s
                    colour stripe turns dashed.
                  </td>
                </tr>
                <tr>
                  <td>
                    <b>M</b>
                  </td>
                  <td>Mutes the track in the preview and in the exported mix.</td>
                </tr>
                <tr>
                  <td>
                    <b>S</b>
                  </td>
                  <td>
                    Solo. While any track is soloed, only soloed tracks play — in the preview and
                    in the exported mix. Press it again to release it.
                  </td>
                </tr>
                <tr>
                  <td>
                    <b>Duplicate</b>
                  </td>
                  <td>
                    Duplicates the track onto the next free channel: its clips, position, path,
                    volume and tempo.
                  </td>
                </tr>
                <tr>
                  <td>
                    <b>✕</b>
                  </td>
                  <td>
                    Removes the track from the timeline. Its settings are kept, and they come
                    back if <b>+ Add track</b> reactivates that channel.
                  </td>
                </tr>
                <tr>
                  <td>
                    <b>Volume</b>
                  </td>
                  <td>Track level, from 0 (silent) to 100 (full).</td>
                </tr>
              </tbody>
            </table>
            <p>
              The text beside the track&apos;s name summarises the lane, for example{' '}
              <code>drums.wav ×3</code> (three clips of one sample). A <code>⚠</code> means one
              of the lane&apos;s samples has expired from the server. See{' '}
              <a href="#projects">Saving and opening projects</a>. A muted or solo-silenced
              track&apos;s clips are drawn dimmed.
            </p>
          </section>

          <section id="positioning">
            <h2>4. Placing sounds in 3D</h2>
            <p>
              The cube is 12 metres across, ±6 m on each axis. You sit at the centre, facing
              −Z with +Y up. A flat screen can only show two axes at once, so each view edits
              two axes and locks the third:
            </p>
            <table className="help-table">
              <thead>
                <tr>
                  <th scope="col">View</th>
                  <th scope="col">Horizontal</th>
                  <th scope="col">Vertical</th>
                  <th scope="col">Locked</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>Front</b> — looking forward
                  </td>
                  <td>X (left ↔ right)</td>
                  <td>Y (down ↔ up)</td>
                  <td>Z (ahead/behind)</td>
                </tr>
                <tr>
                  <td>
                    <b>Top</b> — looking down
                  </td>
                  <td>X (left ↔ right)</td>
                  <td>Z (ahead ↔ behind)</td>
                  <td>Y (down/up)</td>
                </tr>
                <tr>
                  <td>
                    <b>Side</b> — from the right
                  </td>
                  <td>Z (behind ↔ ahead)</td>
                  <td>Y (down ↔ up)</td>
                  <td>X (left/right)</td>
                </tr>
              </tbody>
            </table>
            <p>
              The edges of the cube are labelled with the directions they face, and each dot is
              named with its value on the locked axis (for example <code>Z 2.0</code>).{' '}
              <b>Dot size shows that axis:</b> the nearer a source is to you, the viewer, the
              bigger its dot.
            </p>
            <p>
              To see crowded sources better, hold <kbd>Shift</kbd> and scroll over the cube to zoom
              in or out, or use the <b>−</b> / <b>+</b> buttons beside the view tabs. Click the
              percentage to reset. Zoom only changes how big the cube looks; it never changes the
              sound.
            </p>
            <p>
              Drag a dot to move the sound. The locked axis keeps its value, so setting a full
              3D position by dragging takes two views: for example, set left/right and height in
              Front, then switch to Top and set the depth. The inspector&apos;s <b>X</b>,{' '}
              <b>Y</b> and <b>Z</b> sliders reach every axis from any view; the one for the locked
              axis is marked <i>hidden in view</i>. <b>Center</b> puts the source on the listener.
              Dragging never rotates the cube; only the view tabs do.
            </p>
            <p>
              Distance matters: the closer a source is, the louder it gets. Every track also
              feeds a shared room reverb.
            </p>

            <h3>The 3D view</h3>
            <p>
              The <b>3D</b> tab shows the whole room at once, from any angle. Drag empty space
              (or middle-drag) to orbit around the listener, <kbd>Shift</kbd> + drag or right-drag
              to pan, and <kbd>Shift</kbd> + scroll to zoom. Click the percentage beside the zoom
              buttons to reset the view. The small cone on the listener points the way it faces,
              and the walls are labelled with the directions they face.
            </p>
            <p>
              Click a source to select it: coloured <b>move arrows</b> appear on it —{' '}
              <b>red X</b> points right, <b>green Y</b> up and <b>blue Z</b> behind. Drag an arrow
              to move the source along that axis only; drag one of the small squares to move it
              across that plane, or the centre to move it freely. Each source has a thin stem down
              (or up) to the floor grid at ear height, which makes its height easy to read. The
              inspector&apos;s sliders show the exact values as you drag.
            </p>
          </section>

          <section id="paths">
            <h2>5. Motion paths</h2>
            <p>A track can travel along a loop of keyframes instead of staying in one place.</p>
            <ol className="help-steps">
              <li>
                Select the track and, in the inspector, set <b>Motion</b> to{' '}
                <b>Moves on a path</b>.
              </li>
              <li>
                Press <b>+ Add keyframes</b>. Each click in the cube now drops a numbered
                keyframe.
              </li>
              <li>
                Click to place keyframes. Switch views between clicks to build a 3D path: each
                new keyframe takes the two visible axes from your click and the locked axis from
                the slider in the inspector.
              </li>
              <li>
                Press <b>Done</b> (or <kbd>Esc</kbd>). Drag any keyframe diamond to adjust it
                later.
              </li>
            </ol>
            <ul>
              <li>
                The path is a <b>closed loop</b>: after the last keyframe the sound travels
                back to the first.
              </li>
              <li>
                <b>Loop every</b> (2, 4, 8, 16 or 32 s) is how long one lap takes. Laps are
                timed from the start of the project, so the preview and the exported mix line
                up. Small diamonds along the bottom of the track&apos;s lane mark when the source
                reaches each keyframe.
              </li>
              <li>
                <b>Path shape</b>: <i>Straight lines</i> joins keyframes directly; <i>Smooth
                curve</i> draws a spline through them. Smooth needs at least three keyframes.
              </li>
              <li>
                A path moves only once it has two or more keyframes. While a track is in path
                mode, its dot follows the path and cannot be dragged.
              </li>
              <li>
                Only the selected track&apos;s path can be edited; other paths are drawn faintly.
              </li>
              <li>
                In the <b>3D</b> view, click a keyframe to put the move arrows on it. With{' '}
                <b>+ Add keyframes</b> on, each click drops a keyframe at the same depth as the
                last one (or as the source, for the first); its arrows then place it exactly.
              </li>
              <li>
                <b>Undo</b> removes the last keyframe; <b>Clear</b> removes them all.
              </li>
            </ul>
          </section>

          <section id="timeline">
            <h2>6. Editing on the timeline</h2>
            <p>
              A lane holds <b>clips</b>. Each clip is a piece of a sample placed at a point in
              time. An upload starts as one clip covering the whole project. You can cut it up,
              move pieces around, and paste them onto other lanes. A dark line inside a clip
              marks where a looping sample starts over.
            </p>

            <h3>Tools</h3>
            <dl className="help-defs">
              <dt>
                Select <kbd>V</kbd>
              </dt>
              <dd>
                Drag across a lane to select a time range. Click a clip to select all of it.
                Click empty space to make that lane the paste target.
              </dd>
              <dt>
                Move <kbd>M</kbd>
              </dt>
              <dd>
                Drag a clip to slide it along its lane. Drag inside a selection to cut that
                exact range loose and move it; drop it back and it joins up again. A dropped clip
                never lands on top of another — it moves to the nearest free space.
              </dd>
            </dl>
            <p>
              Hold <kbd>Alt</kbd> while dragging to use the other tool for that one drag.
            </p>

            <h3>Copy, cut, paste, split, delete</h3>
            <ul>
              <li>
                <b>Copy</b> / <b>Cut</b> take everything inside the selection, gaps included.
              </li>
              <li>
                <b>Paste</b> goes into the selected track — click its lane or its name to
                choose it, empty or not — starting at the playhead, or, if audio is already there,
                in the nearest free space that fits. Paste again on the same lane and the new copy goes
                straight after the previous one, so repeated pastes line up end to end. The
                Tracks bar shows which track the clipboard will go to (for example{' '}
                <code>clipboard 2.00s → CH03</code>) and where the next paste will land.
              </li>
              <li>
                Seeking, selecting or editing a lane ends that run: the next paste goes to the
                playhead again.
              </li>
              <li>
                <b>Split</b> cuts the clip under the playhead on the selected track into two.
              </li>
              <li>
                <b>Delete</b> removes the selected range and leaves silence.
              </li>
            </ul>
            <p className="help-callout">
              <b>Nothing on a lane is ever overwritten, and clips never overlap.</b> A paste
              slides left or right to the nearest empty stretch that fits all of it, and so does a
              clip you drag: drop it on another clip and it moves beside it instead. Clips that
              are already there are never moved or cut. Clips past the end of the project (after
              you shorten it) are kept, marked <code>+N ▸</code> at the right of the lane, and come
              back if you make the project longer. To layer sounds on top of each other, put them
              on different tracks.
            </p>
          </section>

          <section id="transport">
            <h2>7. Playback and project length</h2>
            <ul>
              <li>
                <b>Play / Pause</b> (or <kbd>Space</kbd>) starts and pauses playback. Pausing keeps
                the playhead where it is; <b>Stop</b> also returns it to the start, and{' '}
                <b>Back to start</b> jumps there without stopping. The clock shows where the
                playhead is.
              </li>
              <li>
                Click or drag on the ruler to move the playhead, during playback or while
                stopped.
              </li>
              <li>
                Playback loops: at the end of the project it starts again from zero.
              </li>
              <li>
                <b>Length</b> sets the project length, from 3 to 600 seconds. Type a value
                and press Enter. A clip that spans the whole project (a fresh upload, for
                example) grows or shrinks with it. Clips you have placed keep their size.
              </li>
              <li>
                <b>Master</b> scales the whole mix, including the exported file.
              </li>
            </ul>
          </section>

          <section id="tempo">
            <h2>8. Tempo</h2>
            <p>
              <b>Tempo</b>, under Playback in the inspector, sets a track&apos;s speed, from
              0.25× to 4×. It works like changing a record&apos;s speed: faster also raises the
              pitch. It affects every clip on the track, in the preview and in the mix.
            </p>
          </section>

          <section id="projects">
            <h2>9. Saving and opening projects</h2>
            <p>
              <b>Save</b> downloads a <code>.gtfx</code> project file. <b>Open</b> loads one
              back. The file holds the whole arrangement: tracks, clips, positions, paths,
              levels, mute and solo, tempo and waveforms.
            </p>
            <p className="help-callout">
              <b>The audio itself is not in the file.</b> Samples stay on the GreanTeaFX server,
              which keeps each one for 6 hours after it was last used (a default the server
              operator can change). Opening a project or exporting a mix resets that timer.
            </p>
            <p>
              If a sample has expired, the project still opens. Its clips show the label{' '}
              <i>expired</i> and the track shows <code>⚠</code>. Those clips are silent and
              are left out of the exported mix until you upload the sample again.
            </p>
          </section>

          <section id="mixdown">
            <h2>10. Exporting the mix</h2>
            <p>
              <b>Export mix (WAV)</b> sends the arrangement to the server. The server
              renders it with the same spatial processing you hear in the preview and returns a
              16-bit stereo WAV at your browser&apos;s sample rate. The status line reports how
              long the render took.
            </p>
            <ul>
              <li>
                Only active tracks are rendered. Muted tracks are silent in the file, and so is
                every track that is not soloed while a solo is on — the status bar names the
                soloed tracks after an export.
              </li>
              <li>The file is as long as the project length.</li>
              <li>
                Clips whose sample has expired are skipped. The rest of the mix still renders.
              </li>
            </ul>
          </section>

          <section id="shortcuts">
            <h2>11. Keyboard shortcuts</h2>
            <p>
              Shortcuts are ignored while you are typing in a field. On macOS, use{' '}
              <kbd>⌘</kbd> in place of <kbd>Ctrl</kbd>.
            </p>
            <table className="help-table help-shortcuts">
              <thead>
                <tr>
                  <th scope="col">Keys</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {SHORTCUTS.map(([keys, action]) => (
                  <tr key={action}>
                    <td>
                      <Keys keys={keys} />
                    </td>
                    <td>{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section id="troubleshooting">
            <h2>12. Troubleshooting</h2>
            <dl className="help-defs">
              <dt>I hear nothing</dt>
              <dd>
                Browsers block audio until you interact with the page, so press <b>play</b>.
                Then check that the track is not muted, that no other track is soloed, that its
                volume and the Master slider are up, and that the track has clips under the
                playhead.
              </dd>
              <dt>&ldquo;Export failed — is the render service running?&rdquo;</dt>
              <dd>
                The browser could not reach the GreanTeaFX server. Make sure it is running (by
                default on port 4000), then try again.
              </dd>
              <dt>&ldquo;Upload failed&rdquo; or &ldquo;Could not decode that file&rdquo;</dt>
              <dd>
                The file is not in a supported format, is corrupt, or is larger than 64 MB. Try
                converting it to WAV or MP3.
              </dd>
              <dt>I can&apos;t grab a dot in the cube</dt>
              <dd>
                Another dot is probably on top of it. Hide the others with their eye buttons,
                move the one you want, then press <b>Show all</b> — or select the track and use
                the inspector&apos;s sliders. A track in path mode cannot be dragged; drag its
                keyframe diamonds instead.
              </dd>
              <dt>The 3D view says it needs WebGL</dt>
              <dd>
                The browser has WebGL turned off, often because hardware acceleration is disabled
                in its settings. Turn it back on, or use the Front, Top and Side views, which do
                not need it.
              </dd>
              <dt>Clicking the cube adds keyframes when I don&apos;t want it to</dt>
              <dd>
                Adding keyframes is still on. Press <b>Done</b> under the cube or in the
                inspector, or press <kbd>Esc</kbd>.
              </dd>
              <dt>Paste landed in the wrong place</dt>
              <dd>
                Paste goes to the selected track (the highlighted row), at the playhead or right
                after your last paste there. Click the track you want, move the playhead, then
                paste again.
              </dd>
              <dt>&ldquo;No room on … — clear space or lengthen the project&rdquo;</dt>
              <dd>
                The lane has no empty stretch long enough for what you copied, and pasting never
                overwrites audio. Delete or move something on that lane, paste onto another track,
                or make the project longer.
              </dd>
              <dt>A reopened project has silent clips marked &ldquo;expired&rdquo;</dt>
              <dd>
                The server no longer has that sample. Upload it again on the affected track.
              </dd>
            </dl>
          </section>

          <section id="glossary">
            <h2>13. Glossary</h2>
            <dl className="help-defs">
              <dt>HRTF</dt>
              <dd>
                Head-related transfer function. A filter that mimics how your head and ears
                shape sound arriving from a given direction, so it seems to come from that
                point in space.
              </dd>
              <dt>Clip</dt>
              <dd>A piece of a sample placed at a point on a track&apos;s lane.</dd>
              <dt>Keyframe</dt>
              <dd>One point on a motion path.</dd>
              <dt>Playhead</dt>
              <dd>The vertical line showing the current playback position.</dd>
              <dt>Mixdown</dt>
              <dd>All tracks rendered together into a single stereo audio file.</dd>
              <dt>Solo</dt>
              <dd>Hearing only some tracks: while any is soloed, the rest fall silent.</dd>
            </dl>
          </section>

          <p className="help-footer-link">
            <Link href="/" className="help-back">
              ← Back to the console
            </Link>
          </p>
        </article>
      </div>
    </div>
  );
}
