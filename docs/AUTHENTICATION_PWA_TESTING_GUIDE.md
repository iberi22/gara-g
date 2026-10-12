# 🧪 Authentication & PWA Testing Guide - Gara-G

## 📋 **Testing Checklist Overview**

### ✅ **Google Authentication Testing**
- [ ] Google Sign-In button appears on login page
- [ ] Google OAuth popup/redirect works correctly
- [ ] User profile data is retrieved and stored
- [ ] Error handling for various Google Auth scenarios
- [ ] Session persistence works with Google Auth

### ✅ **Session Persistence Testing**
- [ ] "Remember Me" checkbox functionality
- [ ] Local persistence (stays logged in after browser restart)
- [ ] Session persistence (logs out when browser closes)
- [ ] Persistence works with both email and Google authentication
- [ ] Debug component shows correct persistence type

### ✅ **PWA Functionality Testing**
- [ ] Manifest.json loads correctly
- [ ] Service worker registers successfully
- [ ] Install prompt appears on supported browsers
- [ ] App can be installed on mobile devices
- [ ] Offline functionality works
- [ ] App shortcuts work when installed

---

## 🔥 **1. GOOGLE AUTHENTICATION TESTING**

### **Desktop Testing Steps:**

1. **Navigate to Login Page**
   ```
   URL: https://gara-g-app.web.app/auth/login
   ```

2. **Verify Google Sign-In Button**
   - ✅ Button displays "Continuar con Google"
   - ✅ Google logo is visible and properly styled
   - ✅ Button is positioned above the email/password form

3. **Test Google Authentication Flow**
   - Click "Continuar con Google" button
   - ✅ Google OAuth popup opens (or redirects on mobile)
   - ✅ Select/login with Google account
   - ✅ Popup closes and user is redirected to dashboard
   - ✅ Success toast message appears

4. **Verify User Data Storage**
   - Check browser developer tools → Application → Firestore
   - ✅ User document created in `users` collection
   - ✅ Contains: uid, email, displayName, photoURL, provider: 'google'

5. **Test Error Scenarios**
   - Cancel Google popup → ✅ Shows appropriate error message
   - Block popup → ✅ Shows popup blocked message
   - Network error → ✅ Shows network error message

### **Mobile Testing Steps:**

1. **Open on Mobile Browser**
   ```
   URL: https://gara-g-app.web.app/auth/login
   ```

2. **Test Mobile Google Auth**
   - ✅ Uses redirect flow instead of popup
   - ✅ Redirects to Google OAuth page
   - ✅ Returns to app after authentication
   - ✅ User is logged in successfully

---

## 🔐 **2. SESSION PERSISTENCE TESTING**

### **Remember Me Functionality:**

1. **Test Local Persistence (Remember Me = ON)**
   - Navigate to login page
   - ✅ Check "Recordarme" checkbox
   - ✅ Verify helper text shows "Sesión persistirá entre navegadores"
   - Login with email/password or Google
   - ✅ Close browser completely
   - ✅ Reopen browser and navigate to app
   - ✅ User should still be logged in

2. **Test Session Persistence (Remember Me = OFF)**
   - Navigate to login page
   - ✅ Leave "Recordarme" checkbox unchecked
   - ✅ Verify helper text shows "Sesión solo durante esta ventana"
   - Login with email/password or Google
   - ✅ Close browser completely
   - ✅ Reopen browser and navigate to app
   - ✅ User should be logged out

3. **Debug Component Verification**
   - ✅ Session Debug component appears in development mode
   - ✅ Shows correct authentication status
   - ✅ Displays persistence type (local/session)
   - ✅ Shows storage information
   - ✅ "Cerrar Sesión" button works

### **Cross-Authentication Persistence:**

1. **Email + Remember Me**
   - Login with email/password with Remember Me checked
   - ✅ Persistence type shows "local"

2. **Google + Remember Me**
   - Login with Google with Remember Me checked
   - ✅ Persistence type shows "local"
   - ✅ Google profile data persists

---

## 📱 **3. PWA FUNCTIONALITY TESTING**

### **PWA Installation Testing:**

1. **Desktop Browser Testing**
   - Open Chrome/Edge on desktop
   - Navigate to https://gara-g-app.web.app
   - ✅ PWA install button appears on home page
   - ✅ Browser shows install prompt in address bar
   - Click install button or browser prompt
   - ✅ App installs successfully
   - ✅ App icon appears on desktop/start menu

2. **Mobile Browser Testing**
   - Open Chrome/Safari on mobile
   - Navigate to https://gara-g-app.web.app
   - ✅ PWA install button appears
   - ✅ Follow browser-specific install instructions
   - ✅ App installs to home screen
   - ✅ App opens in standalone mode

### **PWA Features Testing:**

1. **Service Worker Verification**
   - Open Developer Tools → Application → Service Workers
   - ✅ Service worker is registered and active
   - ✅ No errors in service worker console

2. **Manifest Verification**
   - Developer Tools → Application → Manifest
   - ✅ Manifest loads correctly
   - ✅ Icons, theme colors, and metadata are correct
   - ✅ Display mode is "standalone"

3. **Offline Functionality**
   - Install the PWA
   - Disconnect from internet
   - ✅ App still loads basic pages
   - ✅ Shows appropriate offline messages
   - ✅ Cached content is available

4. **PWA Debug Component**
   - ✅ PWA Debug component shows in development
   - ✅ Displays correct installation status
   - ✅ Shows supported features
   - ✅ Indicates standalone mode when installed

### **Cross-Platform Testing:**

1. **Android Chrome**
   - ✅ Install prompt appears
   - ✅ App installs to home screen
   - ✅ Opens in standalone mode
   - ✅ Authentication works in PWA mode

2. **iOS Safari**
   - ✅ Manual install instructions appear
   - ✅ "Add to Home Screen" works
   - ✅ App opens in standalone mode
   - ✅ Authentication works in PWA mode

3. **Desktop Chrome/Edge**
   - ✅ Install prompt appears
   - ✅ App installs as desktop app
   - ✅ Window controls work correctly
   - ✅ Authentication works in PWA mode

---

## 🔍 **4. INTEGRATION TESTING**

### **Authentication + PWA Integration:**

1. **Install PWA → Login**
   - Install PWA first
   - Open installed app
   - ✅ Login page loads correctly
   - ✅ Google authentication works in PWA
   - ✅ Session persistence works in PWA

2. **Login → Install PWA**
   - Login first in browser
   - Install PWA
   - ✅ User remains logged in after installation
   - ✅ Session persists in PWA mode

3. **Cross-Session Testing**
   - Login in browser with Remember Me
   - Install and open PWA
   - ✅ User is logged in in PWA
   - ✅ Logout in PWA affects browser session

---

## 🐛 **5. TROUBLESHOOTING COMMON ISSUES**

### **Google Authentication Issues:**
- **Popup blocked**: Enable popups for the domain
- **Redirect loop**: Clear browser cache and cookies
- **OAuth error**: Check Firebase console for correct domain configuration

### **Session Persistence Issues:**
- **Not persisting**: Check if localStorage is enabled
- **Wrong persistence type**: Verify checkbox state before login
- **Cross-tab issues**: Test in incognito mode

### **PWA Installation Issues:**
- **No install prompt**: Check HTTPS, manifest, and service worker
- **Install fails**: Verify all PWA criteria are met
- **Icons missing**: Ensure icon files exist in public/icons/

---

## ✅ **6. TESTING COMPLETION CHECKLIST**

- [ ] All Google authentication flows tested
- [ ] Session persistence verified for both modes
- [ ] PWA installs successfully on multiple platforms
- [ ] Offline functionality works as expected
- [ ] Debug components provide accurate information
- [ ] Cross-platform compatibility confirmed
- [ ] Integration between features works seamlessly

**Testing Status**: 🟢 Ready for Production
