# FilmCraft integration

AutoSubs connects to the desktop FilmCraft app through its authenticated local
control channel. FilmCraft must be started with that channel enabled for each
editing session. It listens on the loopback interface only.

1. Generate a fresh token and launch FilmCraft from the same terminal:

   ```sh
   export FILMCRAFT_CONTROL_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
   printf '%s\n' "$FILMCRAFT_CONTROL_TOKEN"
   filmcraft --control 9876
   ```

   If `filmcraft` is not on your `PATH`, use the path to its desktop executable.
   Keep the terminal open while editing. Do not share or save the token in a
   project or script.

2. Copy the token printed before FilmCraft starts. In AutoSubs, select
   **FilmCraft** from the editor menu and paste it in the
   **Session token** field. AutoSubs keeps it in memory until the app closes.

3. Open a sequence in FilmCraft. AutoSubs shows its name when connected. Choose
   **Timeline** to transcribe the sequence mix, then use **Send to timeline** to
   import the finished subtitles as a new caption track. Clicking a subtitle
   time also moves the FilmCraft playhead.

The **In/Out** option exports the marked range and applies its start offset to
the generated subtitles. The integration sends plain SRT captions; FilmCraft
owns their appearance. Each send imports a new caption track, so undo or remove
an earlier track before resending if you want to replace it.

The bridge currently uses port 9876. FilmCraft's control channel requires the
64-character session token described in its
[control protocol](https://github.com/storytold/filmcraft/blob/main/docs/control-protocol.md).
