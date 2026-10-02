# StepWise

StepWise is a private, two-person status-sharing PWA. It uses Firebase Authentication, Cloud Firestore, and Firebase Hosting. It does not use Cloud Functions, FCM, Analytics, or paid services.

## Configure Firebase

1. Open the Firebase project `status-app-ac8a4` in the Firebase console. The web app config in `firebase-config.js` is prefilled with the values supplied for this project. Firebase web API keys identify the project; access is enforced by Authentication and Firestore rules.
2. In **Authentication → Sign-in method**, enable **Email/Password**. Create the two intended users in **Authentication → Users → Add user**. The app has no registration UI. Its sign-in screen asks for a nickname and password; Firebase uses each email internally. Firebase's email/password provider does not offer a Spark-plan switch that fully disables account creation through its public API, but the Firestore UID allowlist below prevents any other UID from reading or writing app data.
3. The repository's `firebase-config.js` maps the two nicknames to their Firebase Auth emails and UIDs. This project owner has chosen to publish those identifiers in this public portfolio repository. For your own fork, replace the `loginEmails` and `members` values with your own Firebase account details. Never add account passwords or service-account credentials to client code.
4. Create a **Cloud Firestore** database in production mode. The `firestore.rules` file is already configured for the two UIDs in `firebase-config.js`. Deploy these rules. They allow only those two UIDs, permit users to write only their own current status, and let each read only the other person's current status.
5. Install the Firebase CLI, sign in, and select the project:

   ```sh
   npm install -g firebase-tools
   firebase login
   firebase use status-app-ac8a4
   ```

6. From this folder, deploy the rules and static app:

   ```sh
   firebase deploy --only firestore:rules,hosting
   ```

Firebase Hosting serves the app over HTTPS. Open the Hosting URL on each Android phone in Chrome and use **⋮ → Add to Home screen** (or **Install app**, depending on Chrome version).

## Use

Choose Shawarma or Vada Pav and enter that account's Firebase password. The email is mapped behind the scenes and is not shown in the sign-in form. Firebase keeps the account signed in; signing out returns to the nickname/password screen. After 30 seconds in the background, the app signs out and requires Firebase sign-in again.

Status updates sync through a Firestore listener while the app is open. The browser can show an in-app toast and, if permission is granted in the app, a local notification. These are not push notifications and arrive only while the app is running. The last 20 updates are stored with the status and cached locally on the device used to post them.

The service worker caches the static app shell for offline loading. Firebase sign-in, status reads/writes, and realtime updates need an internet connection.