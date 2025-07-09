Observed behavior:

- If an approval is pending when a session goes down we can't deny or approve it in tui.
- If an approval is manually overridden due to the above bug on the web ui then the daemon/tui don't get updated status and yet the tui can keep
  attempting to try and give a response. This results in this pretty gross error message (this also messes up the view frame just like the below)
  :

```
Error: decision failed: failed to deny function call: API error: {"detail":"call already has a response: requested_at=datetime.datetime(2025, 6, 11, 18, 36, 40,
330841) responded_at=datetime.datetime(2025, 6, 11, 19, 38, 29, 228809) approved=True comment='' user_info={'profile_picture_url':
'https://images.clerk.dev/oauth_google/img_2uJkOvaRKl4uwjAlICBwRxsNgCE', 'username': 'allison@humanlayer.dev', 'display_name': 'allison@humanlayer.dev', 'source': 'Web'}
slack_context=None reject_option_name=None slack_message_ts=None failed_validation_details=None"} (status 400
```

- View gets out of proporation when doing certain things? Like denying in-line? Maybe not everything is maintained by views?
- Cannot scroll down to see live view of conversation data? It seems the view goes down to below the bottom bar with the helper keys and the connected
  status. Because of this I can't see the most recent event fully.
- Need way to force execution to pause. Similar to the escape key in the gui.

- Allow ctrl+c to run from any view would be ideal (sometimes doesn't allow it on child views).
- Sometimes the approval comes in but the most recent conversation event isn't the pending tool call? We don't get good visualization here? I don't
  know what tool I'm accepting because I don't see it. Maybe the conversation view doesn't refresh in scenarios like this? Oh, i wonder if this is
  an ordering issue of events? Or not selecting the right one for approval syncing? Something else?
- Would be nice to be able to copy session id to clipboard. Or at least see it visible so I can select and copy. Right now it's hard to easily
  identify which session id is what in conversation view or session list if I need to troubleshoot or resume or do anything with it outside of the
  tui.

- modified date isn't updating in tui? It shows the same as creation date? This seems silly? It should be updated?
- resume input box doesn't accept long enough input. Should probably be the same modal as the creation box?
- resume doesn't seem to work? It goes into failed state? You can look at these to troubleshoot why perhaps (with sqlite at ~/.humanlayer/daemon.db)

```
   ❌     1m ago     1m ago   ~                    default   -   testing
   ❌     4m ago     4m ago   ~                    default   -   The working directory inheritance fi...
   ❌     4m ago     4m ago   ~                    default   -   The working directory inheritance fi...
```

- When you press enter on the resume prompt it kinda flashes weird or something?
- Approvals doesn't actually refresh live? Like not instantly? Kinda annoying. Have to press 1 then 2 to cycle the new state of approvals.
- EVeryonce in a while running sessions don't show up in session view? What's up with that? It's like they dissapear?
- turn count doesn't seem to update until the task is finished? Is this expected? Should we perhaps manually update it based on conversation events
  just to get information there? Or does claude code sdk
- Are sessions that are launched with `--model opus` (via hlyr cli or by selecting opus in tui) actually using this model? We should be able to find
  out by going and looking in the sqlite database to see what the responded model is in events.
- Approvals should maybe dissapear right away when you quickly press "y" or "n"? There is a lag until I guess the daemon responds with success which
  requires an api round trip to humanlayer first? Would maybe be useful to make this shorter? Like make it dissapear right when the daemon receives
  it and then have it pop back up if the api failed or something? Not sure but it makes it so you can't just press a button over and over again and
  have your cursor move to other approvals automatically which is annoying.
- If the list of sessions is longer than the screen I cannot scroll.
- When conversation resumed the new query doesn't get added to the GetConversation view in tui as a user message. Only the original does.
- Conversation view doesn't seemn to auto refersh appropriately? I have to tab out and back in?
- If there is a issue with claude code client itself (like it's out of date locally and doesn't have a new parameter that we're passing to it) then
  the tui doesn't have a clear failure state displayed. You have to go read the sqlite database to understand what's going on.
