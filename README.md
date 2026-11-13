# Three.js Starter Project

A minimal, modern Three.js starter project powered by [Vite](https://vitejs.dev/).

## Features

- ⚡️ **Vite** for fast local development and HMR
- 🎨 **Three.js** with standard setup (Scene, PerspectiveCamera, WebGLRenderer)
- 🕹️ **OrbitControls** enabled for mouse and touch camera navigation
- 📱 Responsive viewport resizing with device pixel ratio handling
- 💡 Basic lighting (Ambient, Directional, Point lights) and sample geometry

## Getting Started

### Development Server

Run the development server with hot module reloading:

```bash
npm run dev
```

Open the local URL displayed in the terminal (usually `http://localhost:5173`) in your browser.

### Production Build

Build the project for production:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Project Structure

```
├── index.html         # HTML entry point
├── package.json       # Dependencies and npm scripts
├── src/
│   ├── main.js        # Three.js scene, camera, lights, mesh, and animation loop
│   └── style.css      # Full-viewport canvas styling
```
