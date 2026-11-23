# Club Voleibol Puertollano - Guía de Publicación y Mantenimiento

## 🚀 Publicar en GitHub Pages (Gratuito)

### Paso 1: Crear una cuenta en GitHub

1. Ve a [github.com](https://github.com) y regístrate si no tienes cuenta.
2. Verifica tu correo electrónico.

### Paso 2: Crear un repositorio en GitHub

1. Inicia sesión en GitHub.
2. Haz clic en el botón **"+"** → **"New repository"**.
3. Nombre del repositorio: `club-voley-puertollano` (o el que prefieras).
4. Selecciona **"Public"**.
5. **No** marques "Initialize this repository with a README" (ya tienes tu propio contenido).
6. Haz clic en **"Create repository"**.

### Paso 3: Subir tu sitio web a GitHub

En tu computadora, abre una terminal (PowerShell) en la carpeta del proyecto y ejecuta:

```powershell
# Conectar tu repositorio local con GitHub
git remote add origin https://github.com/TU_USUARIO/club-voley-puertollano.git

# Subir los archivos
git branch -M main
git push -u origin main
```

> **Nota:** Reemplaza `TU_USUARIO` con tu nombre de usuario de GitHub.

### Paso 4: Activar GitHub Pages

1. Ve a tu repositorio en GitHub.
2. Haz clic en **"Settings"** (Configuración).
3. En el menú lateral, haz clic en **"Pages"**.
4. En **"Source"**, selecciona **"Deploy from a branch"**.
5. En **"Branch"**, selecciona `main` y la carpeta `/(root)`.
6. Haz clic en **"Save"**.

¡Listo! En unos minutos GitHub te dará una URL como:
`https://TU_USUARIO.github.io/club-voley-puertollano/`

Tu sitio ya estará en línea y accesible para todos. 🎉

---

## 🌐 Comprar y Conectar un Dominio Personalizado

### Opción 1: Comprar dominio en Namecheap (recomendado)

1. Ve a [namecheap.com](https://www.namecheap.com).
2. Busca tu dominio deseado (ej: `clubvoleyputllano.es`).
3. Los dominios `.es` cuestan aproximadamente **5-10 €/año**.
4. Compra el dominio.

### Conectar el dominio a GitHub Pages

1. En GitHub, ve a **Settings** → **Pages** de tu repositorio.
2. En **"Custom domain"**, escribe tu dominio (ej: `www.clubvoleyputllano.es`).
3. Haz clic en **"Save"**.
4. En Namecheap, ve a **"Domain List"** → **"Manage"** → **"Advanced DNS"**.
5. Añade los registros DNS que GitHub te indica:
   - Un registro **CNAME** que apunte a `TU_USUARIO.github.io`.
6. Espera hasta **24-48 horas** para que los DNS se propaguen.

> GitHub Pages incluye **HTTPS gratuito** (certificado SSL) automáticamente una vez conectado el dominio.

---

## 🔧 Mantenimiento y Actualizaciones

### Para actualizar el contenido de tu web

Cada vez que quieras modificar el sitio (cambiar textos, imágenes, horarios, etc.):

1. **Edita los archivos** en tu computadora (por ejemplo, `index.html`).
2. **Abre PowerShell** en la carpeta del proyecto.
3. **Ejecuta estos comandos:**

```powershell
# Ver los cambios
git status

# Añadir los archivos modificados
git add .

# Guardar los cambios con un mensaje descriptivo
git commit -m "Descripción del cambio, por ejemplo: Actualizar horarios de entrenamiento"

# Subir los cambios a GitHub
git push
```

4. GitHub Pages actualizará tu sitio automáticamente en **1-2 minutos**.

### Flujo de trabajo recomendado

- **Cambios pequeños** (textos, fechas): Edita directamente el `index.html` y sigue los pasos anteriores.
- **Cambios de imágenes**: Reemplaza el archivo en la carpeta y súbelo con `git add` y `git push`.
- **Respaldo**: Como todo está en GitHub, tu sitio siempre tiene un historial de cambios. Si algo sale mal, puedes revertir a una versión anterior desde la pestaña **"Insights"** → **"History"** de tu repositorio.

---

## 💡 Ventajas de GitHub Pages

| Característica | Detalle |
|---|---|
| **Coste** | 100% gratuito |
| **HTTPS** | Certificado SSL incluido |
| **Dominio personalizado** | Sí, puedes conectar tu propio dominio |
| **Almacenamiento** | Hasta 1 GB de repositorio |
| **Ancho de banda** | 100 GB/mes (más que suficiente) |
| **Mantenimiento** | Solo necesitas Git para actualizar |
| **Historial de cambios** | Automático con Git |

---

## 📞 ¿Necesitas ayuda?

Si en algún momento tienes problemas, revisa:
- La documentación oficial: [pages.github.com](https://pages.github.com)
- La guía de dominios personalizados: [GitHub Pages - Custom Domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)
