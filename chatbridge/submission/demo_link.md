# ChatBridge — Deployed Application

**Deployed URL:** [https://chatbridgeryoiwata.up.railway.app/](https://chatbridgeryoiwata.up.railway.app/)

---

## Project Summary

ChatBridge is a plugin system built on a Chatbox fork (Electron → web) that enables third-party applications to integrate with AI chat via iframes and postMessage. Designed for K-12 education, it allows students to interact with apps — like a chess game or weather dashboard — without leaving the chat window, while the AI remains context-aware of app state throughout the conversation.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Chatbox fork (React 18, Zustand, Vite, TanStack Router, Mantine UI) |
| Backend | Node.js / Express + WebSocket (`ws`) |
| LLM | Anthropic Claude Sonnet 4.6 via `@anthropic-ai/sdk` |
| Database | PostgreSQL via Prisma |
| Auth | Custom JWT (register / login / demo) |
| Sandboxing | iframe `sandbox="allow-scripts"` + postMessage |
| Deployment | Railway (single service) |

## Third-Party Apps

| App | Complexity | Auth | Description |
|---|---|---|---|
| **Chess** | High | None | Interactive chess board (react-chessboard + chess.js) with mid-game AI analysis |
| **Weather** | Low | API key (server-side) | Weather dashboard via OpenWeatherMap proxy |
| **Spotify** | Medium | OAuth2 | Playlist creator with full OAuth popup flow |

## How to Use

1. Visit the deployed URL above
2. Click **"Try Demo"** to log in instantly (no account needed)
3. Type **"let's play chess"** to activate the chess app
4. Ask **"what's the weather in Austin?"** to try the weather dashboard
5. Ask **"create a Spotify playlist"** to see the OAuth integration

## Repository

- **GitLab:** `labs.gauntletai.com/ryoiwata/chatbox`
- **GitHub:** `github.com/ryoiwata/chatbox`

## Architecture

The system uses two deliberately separate communication channels:

- **WebSocket** (client ↔ server): User messages, LLM streaming, conversation persistence
- **postMessage** (parent window ↔ iframe): Tool invocations, state updates, completion signals

When a user mentions an app, Claude calls the `activate_app` tool, which opens an iframe side panel and routes all subsequent messages through the backend WebSocket for full tool-use round-trips with the Anthropic API.