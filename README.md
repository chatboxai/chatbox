<p align="right">
  <a href="README.md">English</a> |
  <a href="./doc/README-CN.md">简体中文</a>
</p>
A full opensource version of Chatbox Community Edition for Desktop and Mobile power by Tauri. 
This repository is fork from https://github.com/Bin-Huang/chatbox.

### Download for Desktop

<table style="width: 100%">
  <tr>
    <td width="25%" align="center">
      <b>Windows</b>
    </td>
    <td width="25%" align="center" colspan="2">
      <b>MacOS</b>
    </td>
    <td width="25%" align="center">
      <b>Android</b>
    </td>
    <td width="25%" align="center">
      <b>Linux</b>
    </td>
  </tr>
  <tr style="text-align: center">
    <td align="center" valign="middle">
      <a href='https://github.com/adzimzf/cha/releases/download/v1.0.2/Cha_1.0.2.exe'>
        <img src='./doc/statics/windows.png' style="height:24px; width: 24px" />
        <br />
        <b>Setup.exe</b>
      </a>
    </td>
    <td align="center" valign="middle">
      <a href='https://github.com/adzimzf/cha/releases/download/v1.0.2/Cha_1.0.2_aarch64.dmg'>
        <img src='./doc/statics/mac.png' style="height:24px; width: 24px" />
        <br />
        <b>Intel</b>
      </a>
    </td>
    <td align="center" valign="middle">
      <a href='https://github.com/adzimzf/cha/releases/download/v1.0.2/Cha_1.0.2_x64.dmg'>
        <img src='./doc/statics/mac.png' style="height:24px; width: 24px" />
        <br />
        <b>M1/M2</b>
      </a>
    </td>
    <td align="center" valign="middle">
      <a href='https://github.com/adzimzf/cha/releases/download/v1.0.2/Cha_1.0.2.apk'>
        <img src='./doc/statics/android.png' style="height:24px; width: 24px" />
        <br />
        <b>APK</b>
      </a>
    </td>
    <td align="center" valign="middle">
      <a href='https://github.com/adzimzf/cha/releases/download/v1.0.2/Cha_1.0.2.dpkg'>
        <img src='./doc/statics/linux.png' style="height:24px; width: 24px" />
        <br />
        <b>AppImage</b>
      </a>
    </td>
  </tr>
</table>

---

<h1 align="center">
<img src='./doc/statics/icon.png' width='30'>
<span>
    Cha 
</span>
</h1>
<p align="center">
    <em>Your AI chat message client on the Desktop & Mobile.</em>
</p>

<p align="center">
<a href="https://github.com/Bin-Huang/chatbox/releases" target="_blank">
<img alt="macOS" src="https://img.shields.io/badge/-macOS-black?style=flat-square&logo=apple&logoColor=white" />
</a>
<a href="https://github.com/Bin-Huang/chatbox/releases" target="_blank">
<img alt="Windows" src="https://img.shields.io/badge/-Windows-blue?style=flat-square&logo=windows&logoColor=white" />
</a>
<a href="https://github.com/Bin-Huang/chatbox/releases" target="_blank">
<img alt="Linux" src="https://img.shields.io/badge/-Linux-yellow?style=flat-square&logo=linux&logoColor=white" />
</a>
<a href="https://github.com/Bin-Huang/chatbox/releases" target="_blank">
<img alt="Downloads" src="https://img.shields.io/github/downloads/Bin-Huang/chatbox/total.svg?style=flat" />
</a>
<a href="https://twitter.com/benn_huang" target="_blank">
<img alt="Twitter" src="https://img.shields.io/badge/follow-benn_huang-blue?style=flat&logo=Twitter" />
</a>
</p>

<p align="center">
<video src="https://github.com/user-attachments/assets/e8ff2ec8-e82f-4700-ba87-570d1237e480" controls="controls" style="max-width: 300px;"></video>
</p>

## Features

### Cha specific features
-   **Online synchronization** to storage providers like:
    - Dropbox
    - Google Drive (soon)
    - One Dive (soon)
-   Multi-platform support to Windows, Mac, Linux, Android and iOS (Once I have the device lol). Thanks to Tauri.
  
-   **Small bundle size installation.**  
    :floppy_disk: By using the OS's native web renderer, the size of a Tauri app can be less than 600KB.
-   Chain of Thought (Reasoning Rendering) rendering for both API Support or Not.
-   Support all AI providers with Open AI standard.
-   Fast rendering for long message. Thanks to Virtuoso.
-   Customization model provider and model for each Chat.
-   Edit, Regenerate and Paginate the Chat Tree.

### Inherit form Chatbox CE
-   **Local Data Storage**  
    :floppy_disk: Your data remains on your device, ensuring it never gets lost and maintains your privacy.

-   **No-Deployment Installation Packages**  
    :package: Get started quickly with downloadable installation packages. No complex setup necessary!

-   **Enhanced Prompting**  
    :speech_balloon: Advanced prompting features to refine and focus your queries for better responses.

-   **Markdown, Latex & Code Highlighting**  
    :scroll: Generate messages with the full power of Markdown and Latex formatting, coupled with syntax highlighting for various programming languages, enhancing readability and presentation.

-   **Prompt Library & Message Quoting**  
    :books: Save and organize prompts for reuse, and quote messages for context in discussions.

-   **Streaming Reply**  
    :arrow_forward: Provide rapid responses to your interactions with immediate, progressive replies.

-   **Ergonomic UI & Dark Theme**  
    :new_moon: A user-friendly interface with a night mode option for reduced eye strain during extended use.

-   **Team Collaboration**  
    :busts_in_silhouette: Collaborate with ease and share OpenAI API resources among your team. [Learn More](./team-sharing/README.md)
  
- **Multilingual Support**  
    :earth_americas: Catering to a global audience by offering support in multiple languages:

    -   English
    -   简体中文 (Simplified Chinese)
    -   繁體中文 (Traditional Chinese)
    -   日本語 (Japanese)
    -   한국어 (Korean)
    -   Français (French)
    -   Deutsch (German)
    -   Русский (Russian)

-   **And More...**  
    :sparkles: Constantly enhancing the experience with new features!

## Why I forked and port to Tauri?

I like Chatbox, however when I want to request feature and try to run the open source version locally. The feature is far behind that I used, after reading the README.md turns out that the version I use is Closed Source version.
Then I fork it and porting to Tauri to support multi-platform, as part of my journey learning Rust and TypeScript.

BTW, my background is Backend Engineering, developing a front-end is a challenge for me, if you find any bug or feature request please reach me out.

## Buy the original author a Coffee

[!["Buy The Original Author A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/benn)


## License

[LICENSE](./LICENSE)
