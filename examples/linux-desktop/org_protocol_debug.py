#!/usr/bin/env python3

import os
import sys
import signal
from subprocess import CompletedProcess, PIPE, Popen
from urllib import parse

HELP = """Usage: {0} -- org-protocol:/SUBPROTOCOL/?DATA
  or:  {0} {{ -h | --help }}
  or:  {0} {{ -d | --desktop }}
Decode org-protocol and display in a dialog to debug desktop integration.
One of the following dialog tool is required: zenity, kdialog, gxmessage, yad.

Alternatively
  -h, --help     display this message and exit.
  -d, --desktop  print content of .desktop file to install this script
                 Do not forget to register it:
                     update-desktop-database ~/.local/share/applications/
                 or
                     xdg-settings set default-url-scheme-handler \
org-protocol org-protocol-debug.desktop"""
                 as the URL scheme handler and exit. Output should be saved
                 to "applications" subdir of $XDG_DATA_HOME or $XDG_DATA_DIRS,
                 e.g. to ~/.local/share/applications/org-protocol-debug.desktop

DESKTOP = """[Desktop Entry]
Name=Debug org-protocol
Comment=Troubleshooting of org-protocol desktop integration
Icon=emacs
# Do not add quotes around %u, reason: undefined behavior by spec
# <https://specifications.freedesktop.org/desktop-entry-spec/desktop-entry-spec-latest.html#exec-variables>
Exec={0} %u
Type=Application
Terminal=false
# Do not show in menu
NoDisplay=true
Keywords=Emacs, Org mode
# Trailing semicolon is required due to
# <https://gitlab.freedesktop.org/xdg/xdg-utils/-/issues/222>
MimeType=x-scheme-handler/org-protocol;"""

WARNING_NETLOC = '''WARNING: It is safer to use either single or triple slash
after org-protocol: to avoid handling of subprotocol as netloc
(host name) by desktop environment due to 2 slashes "//"'''

WARNING_PATH = '''WARNING: No leading slash in path component,
it may cause a problem. It is better to use org-protocol:/SUBPROTOCOL?DATA
or org-protocol:///SUBPROTOCOL?DATA or at least with slash after subprotocol
org-protocol://SUBPROTOCOL/?DATA (when SUBPROTOCOL is considered as host name).
Format org-protocol:SUBPROTOCOL?DATA is not supported.'''

WARNING_QUERY = '''WARNING: Query part is missed. Likely you are using
old syntax, see capture protocol section in the manual
and 9.0 changes in https://orgmode.org/Changes_old.html'''

KILL_CHILD_SIGNALS = [
    signal.SIGHUP, signal.SIGINT, signal.SIGQUIT, signal.SIGKILL,
    signal.SIGTERM]
"""Treat these signals as intention to kill dialog

If a dialog tool receives one of these signals kill the script.
Other signals are treated as the tool failure with fallback to
next one.  A command to test behavior:

    kill -IO "$(ps --ppid "$!" -o pid=)"
"""


def help_message():
    return HELP.format(sys.argv[0])


def desktop():
    print(DESKTOP.format(os.path.realpath(sys.argv[0])))


# I am afraid, argparse could do something unexpectedly clever.
def parse_args(args):
    if not (len(args) > 0):
        return args
    arg = args[0]
    if arg == '--':
        return args
    if arg == "-d" or (len(arg) > 2 and arg == "--desktop"[:len(arg)]):
        desktop()
        sys.exit(0)

    do_help = False
    for arg in args:
        if len(arg) < 2 or arg[0] != "-":
            continue
        if arg == "--":
            break
        if arg == "-h" or (len(arg) > 2 and arg == "--help"[:len(arg)]):
            do_help = True

    if do_help:
        print(help_message())
        sys.exit(0)

    return args


def run(cmd, input=None, **kwargs):
    """Run subprocess and kill it or the script if it counterpart is killed

    Similar to ``subprocess.run()``, but consider SIGTERM, SIGINT, etc.
    as intention to terminate both the script and the subprocess.

    Unsure if it would be better to call ``os.setpgid`` and to rely
    on SIGHUP sent to other members of the process group when
    the script is died. It may be better to handle SIGKILL,
    but I am unsure if it may interfere with shell job control."""
    child = None
    handlers = []
    # See signal(7)
    signals_keep = {
        signal.SIGSTOP, signal.SIGKILL,  # OSError: [Errno 22] Invalid argument
        signal.SIGCHLD,  # handled by ``subprocess.Popen``
        signal.SIGCONT, signal.SIGTSTP,  # regular job control
        # Ignored by default, do not die e.g. on terminal resize.
        signal.SIGURG, signal.SIGWINCH}

    def kill_self(sig):
        signal.signal(sig, signal.SIG_DFL)
        # TODO Can xdg-open try next handler in the case of killed handler?
        os.kill(0, sig)
        # Should not happen.
        try:
            name = signal.Signals(sig).name
        except:  # noqa: E722
            name = signal.strsignal(sig) or sig
        print(f"Not killed by {name!r}, trying SIGKILL", file=sys.stderr)
        os.kill(0, signal.SIGKILL)
        assert False, "Internal error, the process should be dead already"

    def handler(sig, _frame):
        if child is not None:
            child.kill()
        kill_self(sig)

    def restore_handler():
        while handlers:
            sig, h = handlers.pop()
            signal.signal(sig, h)

    def set_handler(signals, h):
        for sig in signals:
            signal.signal(sig, h)

    if input is not None:
        if kwargs.get("stdin") is not None:
            raise ValueError(
                'stdin and input arguments are mutualy incompatible')
        kwargs['stdin'] = PIPE

    try:
        set_handler(signal.valid_signals() - signals_keep, handler)
        # similar to `subprocess.run()`
        with Popen(cmd, **kwargs) as child:
            try:
                stdout, stderr = child.communicate(input)
            except:  # noqa: E722
                child.kill()
                raise
            retcode = child.poll()
            args = child.args
            child = None
    finally:
        restore_handler()

    if retcode < 0 and -retcode in KILL_CHILD_SIGNALS:
        # "wait and cooperative exit"
        # <https://www.cons.org/cracauer/sigint.html>
        # Martin Cracauer. Proper handling of SIGINT/SIGQUIT. 2013
        kill_self(-retcode)

    return CompletedProcess(args, retcode, stdout, stderr)


def find_in_path(binary):
    for p in os.getenv("PATH").split(os.pathsep):
        full = os.path.join(p, binary)
        if os.access(full, os.X_OK):
            return full


def dialog_zenity(title, text):
    executable = find_in_path("zenity")
    if not executable:
        return

    # --textinfo requires --filename=FILE or --url=URL
    command = [
        executable, "--info", "--no-markup",
        "--title", title, "--text", text]
    res = run(command)
    # Cancel is 1, invalid option is 255
    if res.returncode not in (0, 1):
        print("{0}: command returned {1}: {2}".format(
            sys.argv[0], res.returncode,
            " ".join(["{!r}".format(a) for a in command])))
        return
    return True


def dialog_kdialog(title, text):
    executable = find_in_path("kdialog")
    if not executable:
        return

    def kdialog_escape(txt):
        """Prevent "Unrecognized escape sequence \\x" and formatting

        It may happen for non-breaking space %C2%A0
        converted to \\xa0 by ``str.__repr__()``.
        I have not found a kdialog option disabling interpretation
        of escape characters.

        Force HTML by wrapping into ``<pre>`` to not depend on message text."""
        if not txt:
            return ""

        return "<pre style='white-space: pre-wrap;'>{0}</pre>".format(
            txt.translate(str.maketrans({
                '\\': '\\\\', '&': '&amp;', '<': '&lt;', '>': '&gt;'})))

    # --textbox requires file name
    command = ["kdialog", "--title", title, "--msgbox", kdialog_escape(text)]
    res = run(command)
    # Cancel is 2, invalid option is 1
    if res.returncode not in (0, 2):
        print("{0}: command returned {1}: {2}".format(
            sys.argv[0], res.returncode,
            " ".join(["{!r}".format(a) for a in command])))
        return
    return True


def dialog_yad(title, text):
    """Unlike zenity, yad does not have heavy dependencies"""
    executable = find_in_path("yad")
    if not executable:
        return
    # Without --selectable-labels text could not be selected,
    # with it all text is selected that is even worse.
    command = [
        executable,
        "--center", "--wrap", "--no-markup",
        "--title", title, "--text", text]
    res = run(command)
    # Cancel is 1, escape is 252, unable to get invalid option error
    if res.returncode not in (0, 1, 252):
        print("{0}: command returned {1}: {2}".format(
            sys.argv[0], res.returncode,
            " ".join(["{!r}".format(a) for a in command])))
        return
    return True


def dialog_gxmessage(title, text):
    """Lightweight gxmessage dialogue tool"""
    executable = find_in_path("gxmessage")
    if not executable:
        return
    # Without --selectable-labels text could not be selected,
    # with it all text is selected that is even worse.
    command = [
        executable,
        "-center", "-wrap", "-default", "okay", "-file", "-", "-title", title]
    res = run(command, stderr=PIPE, text=True, input=text)
    if res.returncode == 0:
        return True
    elif res.returncode == 1 and res.stderr == '':
        # The window is closed using the button in the title bar.
        return True

    cmd = " ".join((f"{a!r}" for a in command))
    print(
        f"{sys.argv[0]}: exit code {res.returncode}\n{cmd}\n{res.stderr}",
        file=sys.stderr)
    return


def dialog_xmessage(title, text):
    """Simple xmessage X11 tool"""
    executable = find_in_path("xmessage")
    if not executable:
        return
    # TODO: `-xrm` translations to handle Escape
    command = [
        executable,
        "-center", "-xrm", "*international: true", "-default", "okay",
        "-file", "-"]
    text = f"{title}\n\n{text}"
    res = run(command, stderr=PIPE, text=True, input=text)
    if res.returncode == 0:
        return True
    elif res.returncode == 1 and res.stderr == '':
        # The window is closed using the button in the title bar.
        return True

    cmd = " ".join((f"{a!r}" for a in command))
    print(
        f"{sys.argv[0]}: exit code {res.returncode}\n{cmd}\n{res.stderr}",
        file=sys.stderr)
    return


def dialog_order(xdg_current_desktop=None):
    """
    Sort dialog tools by priority depending on XDG desktop environment

    Unsupported tools:
    - gtkdialog
      Removed from Debian in 2009, as unmaintained see
      <https://tracker.debian.org/pkg/gtkdialog>
      <https://bugs.debian.org/543945>
    - xdialog (gtk1.2)
      Removed from Debian in 2009, see
      <https://tracker.debian.org/pkg/xdialog>
      <https://bugs.debian.org/517390>

    >>> def list_names(l): return list(map(lambda x: x.__name__, l))
    >>> list_names(dialog_order(b""))  # doctest: +NORMALIZE_WHITESPACE
    ['dialog_zenity', 'dialog_gxmessage', 'dialog_yad', 'dialog_xmessage',
    'dialog_kdialog']
    >>> list_names(dialog_order(b"KDE"))  # doctest: +NORMALIZE_WHITESPACE
    ['dialog_kdialog', 'dialog_zenity',
    'dialog_gxmessage', 'dialog_yad', 'dialog_xmessage']
    >>> list_names(dialog_order(b"SOMETHING:KDE"))
    ... # doctest: +NORMALIZE_WHITESPACE
    ['dialog_zenity', 'dialog_kdialog',
    'dialog_gxmessage', 'dialog_yad', 'dialog_xmessage']
    >>> from contextlib import contextmanager
    >>> @contextmanager
    ... def xdg_c_d(desktop):
    ...     v = b"XDG_CURRENT_DESKTOP"
    ...     c_d = os.environb.get(v, None)
    ...     try:
    ...         if desktop is not None:
    ...             os.environb[v] = desktop
    ...         elif c_d is not None:
    ...             del os.environb[v]
    ...         yield
    ...     finally:
    ...         if c_d is not None:
    ...             os.environb[v] = c_d
    ...         elif desktop is not None:
    ...             del os.environb[v]
    >>> with xdg_c_d(None):
    ...     list_names(dialog_order())
    ...     # doctest: +NORMALIZE_WHITESPACE
    ['dialog_zenity', 'dialog_gxmessage', 'dialog_yad', 'dialog_xmessage',
    'dialog_kdialog']
    >>> with xdg_c_d(b"KDE:SOMETHING"):
    ...     list_names(dialog_order())
    ...     # doctest: +NORMALIZE_WHITESPACE
    ['dialog_kdialog', 'dialog_zenity',
    'dialog_gxmessage', 'dialog_yad', 'dialog_xmessage']
    >>> with xdg_c_d(b"SOMETHING:KDE:ANOTHER"):
    ...     list_names(dialog_order())
    ...     # doctest: +NORMALIZE_WHITESPACE
    ['dialog_zenity', 'dialog_kdialog',
    'dialog_gxmessage', 'dialog_yad', 'dialog_xmessage']
    """
    if xdg_current_desktop is None:
        xdg_current_desktop = os.environb.get(b"XDG_CURRENT_DESKTOP", b"")
    xdg_current_desktop = xdg_current_desktop.split(b":")
    order = [dialog_zenity, dialog_gxmessage, dialog_yad, dialog_xmessage]
    pos = len(order)
    if xdg_current_desktop[0] == b"KDE":
        pos = 0
    elif b"KDE" in xdg_current_desktop:
        pos = 1
    order.insert(pos, dialog_kdialog)
    return order


def show_dialog(title, text):
    for b in dialog_order():
        if b(title, text):
            return

    raise RuntimeError(
        "Neither zenity nor kdialog, gxmessage, yad, xmessage are installed")


def wrap(text, size):
    for line in text.split("\n"):
        yield from (
                line[start:start+size]
                for start in range(0, len(line), size))


def main():
    args = parse_args(sys.argv[1:])

    title = "Org-protocol Debug Handler"
    details = [
        "org-protocol: handler called with the following arguments",
    ]
    details.append("Number of arguments: {0}".format(len(args)))
    for i, arg in enumerate(args):
        if i > 0 or arg != '--' or len(args) == 1:
            details.append("[{0}]".format(i + 1).center(80, '='))
        details.append(arg)
        try:
            if arg.startswith("org-protocol:"):
                parsed = parse.urlsplit(arg)
                for par in [
                        "scheme", "username", "password", "netloc",
                        "path", "params", "fragment"]:
                    val = getattr(parsed, par, None)
                    if par == "path" and not (val and val.startswith('/')):
                        details.append(WARNING_PATH)
                    if val:
                        details.append(f'{par} = {val!r}')
                        if par == 'netloc':
                            details.append(WARNING_NETLOC)
                if parsed.query:
                    for par, val in parse.parse_qsl(parsed.query):
                        lines = val.split("\n")
                        if len(lines) > 1:
                            details.append("{0} ".format(par).ljust(80, '-'))
                            details.extend(lines)
                            details.append("-".ljust(80, '-'))
                        else:
                            details.append(f'{par} = {val!r}')
                else:
                    details.append(WARNING_QUERY)

        except Exception as ex:
            details.append(str(ex))

    if len(args) == 0:
        details.append(help_message())
    wrapped = (w for line in details for w in wrap(line, 80))
    show_dialog(title, "\n".join(wrapped))


if __name__ == '__main__':
    main()
