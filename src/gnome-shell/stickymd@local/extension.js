'use strict';

const {Clutter, Gio, GLib, St} = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const EXTENSION_UUID = 'stickymd@local';

let indicator = null;
let startItem = null;
let quitItem = null;
let pressHandlerId = 0;
let stateTimerId = 0;

function executablePath() {
    return GLib.build_filenamev([
        GLib.get_home_dir(),
        '.local',
        'bin',
        'stickymd',
    ]);
}

function controlSocketPath() {
    return GLib.build_filenamev([
        GLib.get_home_dir(),
        '.local',
        'state',
        'simple-sticky',
        'control.sock',
    ]);
}

function isRunning() {
    return GLib.file_test(controlSocketPath(), GLib.FileTest.EXISTS);
}

function updateState() {
    if (indicator === null)
        return;

    const running = isRunning();
    indicator.opacity = running ? 255 : 110;
    indicator.accessible_name = running
        ? 'StickyMD: running; click to create a note'
        : 'StickyMD: stopped; click to restore notes';

    if (startItem !== null) {
        startItem.label.text = running ? 'StickyMD is running' : 'Start StickyMD';
        startItem.setSensitive(!running);
    }
    if (quitItem !== null)
        quitItem.setSensitive(running);
}

function queueStateRefresh() {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
        updateState();
        return GLib.SOURCE_REMOVE;
    });
}

function runCommand(command) {
    const argv = [executablePath(), command];

    try {
        const process = Gio.Subprocess.new(
            argv,
            Gio.SubprocessFlags.STDOUT_SILENCE |
                Gio.SubprocessFlags.STDERR_SILENCE
        );
        process.wait_check_async(null, (source, result) => {
            try {
                source.wait_check_finish(result);
            } catch (error) {
                logError(error, `StickyMD ${command} command failed`);
            }
            queueStateRefresh();
        });
    } catch (error) {
        logError(error, `Could not run StickyMD ${command}`);
    }
}

function init() {
}

function enable() {
    indicator = new PanelMenu.Button(0.0, 'StickyMD', false);
    indicator.add_child(new St.Icon({
        icon_name: 'document-edit-symbolic',
        style_class: 'system-status-icon',
    }));

    startItem = new PopupMenu.PopupMenuItem('Start StickyMD');
    startItem.connect('activate', () => runCommand('start'));
    indicator.menu.addMenuItem(startItem);

    const newItem = new PopupMenu.PopupMenuItem('New note');
    newItem.connect('activate', () => runCommand('new'));
    indicator.menu.addMenuItem(newItem);
    indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    quitItem = new PopupMenu.PopupMenuItem('Quit StickyMD');
    quitItem.connect('activate', () => runCommand('quit'));
    indicator.menu.addMenuItem(quitItem);

    pressHandlerId = indicator.connect('button-press-event', (_actor, event) => {
        const button = event.get_button();
        if (button === Clutter.BUTTON_PRIMARY) {
            indicator.menu.close();
            runCommand(isRunning() ? 'new' : 'start');
            return Clutter.EVENT_STOP;
        }
        if (button === Clutter.BUTTON_SECONDARY) {
            updateState();
            // PanelMenu.Button already toggles its menu for every button press
            // in GNOME Shell 42. Toggling again here would immediately close it.
            return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    Main.panel.addToStatusArea(EXTENSION_UUID, indicator, 0, 'right');
    updateState();
    stateTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        updateState();
        return GLib.SOURCE_CONTINUE;
    });
}

function disable() {
    if (stateTimerId !== 0)
        GLib.source_remove(stateTimerId);
    stateTimerId = 0;

    if (indicator !== null && pressHandlerId !== 0)
        indicator.disconnect(pressHandlerId);
    pressHandlerId = 0;

    if (indicator !== null)
        indicator.destroy();
    indicator = null;
    startItem = null;
    quitItem = null;
}
