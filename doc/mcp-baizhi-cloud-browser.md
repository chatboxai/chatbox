# Connect Baizhi Cloud Browser in Chatbox

[简体中文](./mcp-baizhi-cloud-browser.zh-CN.md)

[Baizhi Cloud Browser](https://baizhibrowser.cloud/), also known as CapyBrowser,
provides cloud browser session, saved-profile, human-handoff and download
management over MCP. Page navigation, clicks and reading require a compatible
CDP client available to your agent. Connecting this MCP does not install page
tools or replace Chatbox's browser capabilities.

Baizhi Cloud Browser and Baizhi Cloud Agent Toolkit are two independent Baizhi
Cloud services. Configure this connection's credentials separately; do not
assume a Toolkit application key is valid for the browser service. See the
[browser setup guide](https://capybrowser.app.baizhi.cloud/docs/installation.md)
for the current application-key and platform-personal-key options. Browser
startup and runtime are billed by the service.

## Add a custom HTTP server

Use a Chatbox build with **Settings → MCP → Custom MCP Servers**. This guide uses
the existing custom-server form and does not require a catalog entry.

1. Choose **Add Server → Add Custom Server**.
2. Set **Name** to `Baizhi Cloud Browser`, **Type** to **Remote (http/sse)** and
   **Protocol** to **Auto (recommended)**.
3. Enter `https://capybrowser.app.baizhi.cloud/mcp` as the URL.
4. In **HTTP Header**, enter one line using the form's `NAME=VALUE` syntax:

   ```text
   Authorization=Bearer <your-browser-key>
   ```

   Replace the placeholder locally with your own key, keeping exactly one
   `Bearer` prefix. This field is a plain text area, not a dedicated password
   field. Do not share its contents, screenshots or exported settings containing
   your key; this guide makes no claim about encrypted credential storage.
5. Review the destination and header, then choose **Connect**. Check the displayed
   tools or connection error before choosing **Save**. A saved configuration or
   visible tool list does not prove that every tool is authorized or that a
   complete browser task can run.

Custom entries are enabled by default when added. Use the entry's switch to
turn it off when you do not want it available. Do not leave a placeholder key in
an enabled connection. The example does not change model settings, install a
local proxy or configure automatic tool approval.

## Use, rotate and remove

Read the setup guide and check authentication and pricing before creating a
browser run. Confirm that your agent has compatible CDP page-control tools.
Pause agent actions during human interaction, keep the same run and resume only
after control is returned. End runs you create and check release and final
billing separately. Viewing, waiting, disconnecting or disabling MCP does not
stop the run or its runtime charges.

To replace the key, choose **Edit**, change the Authorization line and reconnect
before saving. If authentication fails, check the key's current applicability
and the single Bearer prefix. Avoid repeated retries of potentially billable
tools. To disable the connection, use its switch. To remove it, use **Edit →
Delete** and confirm; leave other entries intact. Removing the local connection
does not revoke the cloud key or end existing cloud runs.

Tool inputs go to Baizhi Cloud and page activity reaches the websites you visit.
Review the service terms and privacy information before sending data. For
service/account help, use the [browser console](https://capybrowser.app.baizhi.cloud/)
and [setup guide](https://capybrowser.app.baizhi.cloud/docs/installation.md).

## Maintenance and support

Configuration example: [source](https://github.com/ctcbyzx/chatbox/blob/fd229d87d6e2659724e8e3c95c3c862fd59901a2/doc/mcp-baizhi-cloud-browser.md).

Maintained by [ctcbyzx](https://github.com/ctcbyzx), a contributor to [Chaitin's public integration guides](https://github.com/chaitin/baizhi-cloud-browser). See [other browser integrations](https://github.com/ctcbyzx/baizhi-cloud-browser).

For setup help, use the [integration issue tracker](https://github.com/ctcbyzx/baizhi-cloud-browser/issues) and include the client version and a redacted error. Use the service console for private account or billing questions.
