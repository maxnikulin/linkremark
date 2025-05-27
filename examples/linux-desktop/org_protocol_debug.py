#!/usr/bin/env python3

import os.path
import sys
from subprocess import run
from urllib import parse

HELP = """Usage: {0} org-protocol:/SUBPROTOCOL/?DATA
  or:  {0} {{ -h | --help }}
  or:  {0} {{ -d | --desktop }}
Decode org-protocol and display in a dialog to debug desktop integration.
One of the following dialog tool is required: zenity, kdialog, gxmessage, yad.

Alternatively
  -h, --help     display this message.
  -d, --desktop  print content of .desktop file to install this script
                 as the scheme handler. Should be saved to "applications"
                 subdir of $XDG_DATA_HOME or $XDG_DATA_DIRS, e.g.
                 ~/.local/share/applications/x-org-protocol-debug.desktop
                 Do not forget to register it:
                     update-desktop-database ~/.local/share/applications/
                 or
                     xdg-settings set default-url-scheme-handler \
org-protocol org-protocol-debug.desktop"""

DESKTOP = """[Desktop Entry]
Name=Debug org-protocol
Comment=Troubleshooting of org-protocol desktop integration
Icon=emacs
# Do not add quotes around %u, reason: undefined behavior by spec
# <https://specifications.freedesktop.org/desktop-entry-spec/desktop-entry-spec-latest.html#exec-variables>
Exec={0} %u
Type=Application
Terminal=false
Categories=Utility;TextEditor;Debugger
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


def help():
    print(HELP.format(sys.argv[0]))


def desktop():
    print(DESKTOP.format(os.path.realpath(sys.argv[0])))


# I am afraid, argparse could do something unexpectedly clever.
def parse_args(args):
    do_help = False
    do_desktop = False
    i = 0
    for arg in args:
        i += 1
        if arg == "--":
            break
        if arg == "" or arg[0] != "-":
            continue
        if arg == "-h" or (len(arg) > 2 and arg == "--help"[:len(arg)]):
            do_help = True
        elif i == 1 and (
                arg == "-d" or
                (len(arg) > 2 and arg == "--desktop"[:len(arg)])):
            do_desktop = True

    if do_help:
        help()
        return True
    elif do_desktop:
        desktop()
        return True


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
    res = run(command, check=False)
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
        """Prevent "Unrecognized escape sequence \\x"

        It may happen for non-breaking space %C2%A0
        converted to \\xa0 by ``str.__repr__()``.
        I have not found a kdialog option disabling interpretation
        of escape characters."""
        return txt and txt.replace('\\', '\\\\')

    # --textbox requires file name
    command = [
        "kdialog", "--title", kdialog_escape(title),
        "--msgbox", kdialog_escape(text)
    ]
    res = run(command, check=False)
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
    res = run(command, check=False)
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
    command = [executable, "-center", "-wrap", "-title", title, text]
    res = run(command, check=False)
    # Cancel is 1, escape is 252, invalid options are shown literary
    if res.returncode not in (0, 1):
        print("{0}: command returned {1}: {2}".format(
            sys.argv[0], res.returncode,
            " ".join(["{!r}".format(a) for a in command])))
        return
    return True


def show_dialog(title, text):
    backends = [dialog_zenity]
    if os.getenv("KDE_FULL_SESSION"):
        backends.insert(0, dialog_kdialog)
    else:
        backends.append(dialog_kdialog)
    backends.append(dialog_gxmessage)
    backends.append(dialog_yad)

    for b in backends:
        if b(title, text):
            return

    raise RuntimeError(
            "Neither zenity nor kdialog. gxmessage, yad are installed")


def wrap(text, size):
    for line in text.split("\n"):
        yield from (
                line[start:start+size]
                for start in range(0, len(line), size))


def main():
    args = sys.argv[1:]
    if len(args) > 0 and parse_args(args):
        return

    title = "Org-protocol Debug Handler"
    details = [
        "org-protocol: handler called with the following arguments",
    ]
    details.append("Number of arguments: {0}".format(len(args)))
    i = 0
    for arg in args:
        i += 1
        details.append("[{0}]".format(i).center(80, '='))
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

    wrapped = (w for line in details for w in wrap(line, 80))
    show_dialog(title, "\n".join(wrapped))


if __name__ == '__main__':
    main()
