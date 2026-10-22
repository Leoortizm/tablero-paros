# Publicar el tablero en Firebase

Resultado: una página pública que cualquiera con el enlace puede ver, y donde solo tú (con tu cuenta de Google) puedes cargar los reportes.

- Los visitantes ven el tablero con los datos ya cargados. No ven el recuadro de carga.
- El administrador inicia sesión con Google desde el enlace "Acceso administrador" (al final de la página) y le aparece "Cargar reportes".
- Los datos (un resumen por línea) viven en Firestore. Las reglas de `firestore.rules` permiten leer a todos y escribir solo a los administradores.

Todo cabe en el plan gratuito (Spark), sin tarjeta.

## 1. Crear el proyecto
1. Entra a https://console.firebase.google.com y crea un proyecto (puedes desactivar Google Analytics).
2. **Build → Authentication → Comenzar → Google**: actívalo y elige tu correo de soporte.
3. **Build → Firestore Database → Crear base de datos**: elige modo producción y una región.
4. **Configuración del proyecto → Tus apps → Web (`</>`)**: registra una app. Copia el objeto `firebaseConfig`.

## 2. Configuración local
1. Copia `firebase/firebase-config.example.json` como `firebase/firebase-config.json` y pega tus valores. Este archivo está en `.gitignore`.
2. Los datos del `firebaseConfig` no son secretos (están pensados para ir en la página), pero así quedan fuera del repositorio.

## 3. Armar y publicar
Necesitas Node.js y Python.
```
npm install -g firebase-tools
firebase login
firebase use --add          # elige tu proyecto
python3 build.py --firebase # genera public/index.html
firebase deploy             # publica la página y las reglas
```
La dirección queda en `https://TU-PROYECTO.web.app`.

## 4. Darte permiso de administrador
1. Abre la página y toca **Acceso administrador**; entra con tu cuenta de Google.
2. Verás un aviso rojo "Sin permiso de edición. Tu UID: …". Copia ese UID.
3. En la consola: **Firestore Database → Iniciar colección** → ID de colección `admins`, ID de documento = tu UID, con cualquier campo (por ejemplo `ok` = `true`).
4. Recarga la página, entra de nuevo y aparece **Cargar reportes**. Carga tus Excel; los visitantes verán los datos al instante.

## Mantenimiento
- Para dar acceso a otra persona como administradora, crea su documento en `admins`.
- Para quitarlo, borra ese documento.
- Si cambias el código, vuelve a correr `python3 build.py --firebase` y `firebase deploy`.

## Privacidad
La lectura es pública: quien tenga el enlace puede ver los datos cargados (horas de paro por línea y comentarios de los paros). Revisa que esto esté permitido por tu organización. Si más adelante quieres limitar la lectura, cambia `allow read: if true;` en `firestore.rules` por `if request.auth != null;` y pide inicio de sesión también a los visitantes.
