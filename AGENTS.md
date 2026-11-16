# Projekt-Regeln & Design-System

## Tech-Stack

- **Framework:** Astro (nutze `.astro` Komponenten, vermeide unnötiges Client-Side-JavaScript).
- **Styling:** Ausschließlich Tailwind CSS Utility-Klassen. Schreibe keine eigenen `<style>`-Blöcke, außer für komplexe Keyframe-Animationen.
- **Icons:** Nutze `lucide-astro` für Icons.

## Design-Richtlinien

- **Stil:** Modern, viel Weißraum (Whitespace), klare Typografie, subtile Rahmen (`border-slate-200`) statt schwerer Schatten.
- **Farben:**
  - Hintergrund: `bg-slate-50` / Karten: `bg-white`
  - Primärtext: `text-slate-900` / Sekundärtext: `text-slate-600`
  - Akzentfarbe: `indigo-600` (Hover: `indigo-700`)
- **Layout:** Nutze durchgängig `max-w-6xl mx-auto px-4 sm:px-6 lg:px-8` für den Hauptinhalt.
- **Mobile First:** Alle Komponenten müssen auf 375px Breite einwandfrei funktionieren.
