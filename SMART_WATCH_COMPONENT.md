# Smart Watch Component

The smart watch now lives as a normal component and server helper instead of under a `portable` folder.

Client:

- [src/components/smart-watch/index.js](/Users/ek/Documents/GitHub/PlayfulNYC_Team3/src/components/smart-watch/index.js)
- [src/components/smart-watch/watch-system.js](/Users/ek/Documents/GitHub/PlayfulNYC_Team3/src/components/smart-watch/watch-system.js)
- [src/components/smart-watch/state.js](/Users/ek/Documents/GitHub/PlayfulNYC_Team3/src/components/smart-watch/state.js)
- [src/components/smart-watch/watch-ui.js](/Users/ek/Documents/GitHub/PlayfulNYC_Team3/src/components/smart-watch/watch-ui.js)

Server:

- [server/smart-watch/landlord-call.js](/Users/ek/Documents/GitHub/PlayfulNYC_Team3/server/smart-watch/landlord-call.js)
- [server/smart-watch/.env.local.example](/Users/ek/Documents/GitHub/PlayfulNYC_Team3/server/smart-watch/.env.local.example)

Integrated entrypoints:

- [src/main.js](/Users/ek/Documents/GitHub/PlayfulNYC_Team3/src/main.js)
- [server/main.js](/Users/ek/Documents/GitHub/PlayfulNYC_Team3/server/main.js)

The integration is intentionally small:

- one import in `src/main.js`
- one component creation call
- one update call inside the existing animation loop
- one server route registration before the static build middleware

Global watch APIs are available after the component is created:

```js
window.updateSmartWatchNeed('hunger', -10)
window.setSmartWatchNeed('energy', 90)
```
