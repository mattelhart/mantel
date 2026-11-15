# Privacy policy

Mantel is a self-hosted family wall calendar. You run it on your own hardware. Matt Elhart ([mattelhart](https://github.com/mattelhart) on GitHub) maintains the open-source project. This policy explains what a Mantel server does with Google account data when you connect Google Calendar.

**Effective date:** November 15, 2026.

## What Mantel asks Google for

When you connect a Google account, Mantel requests only these OAuth scopes:

- `https://www.googleapis.com/auth/calendar` — access to Google Calendar, so your server can read the household's events and write back events you add or change on your own wall display or companion apps.
- `https://www.googleapis.com/auth/userinfo.email` — the email address of that Google account, so the household can see which account is linked.

Mantel uses this information only to show the household's events on your own wall display and companion apps, and to keep those events in sync with Google Calendar. The email address is used only to label the linked account.

## Where data is stored

OAuth tokens, cached events, and the SQLite database stay on your own server (the data folder, mounted at `/data` in the usual Docker setup). Nothing is sold, shared with third parties, or sent to the developer. There are no analytics and no ads.

Your server talks to Google directly. The maintainer of the Mantel source code does not operate that server and does not receive its data.

## Google API Services User Data Policy

Mantel's use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Revoking access and deleting data

You can revoke Mantel's access at any time at <https://myaccount.google.com/permissions>.

To delete the data Mantel has stored, delete the server's data folder (the Docker volume mounted at `/data`, which holds the SQLite database and related files).

## Contact

Questions about this policy: open an issue at <https://github.com/mattelhart/mantel/issues>.
