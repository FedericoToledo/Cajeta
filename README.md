# VexionBox 📦

> Herramienta de uso gratuito de **Vexion.ar** — todos los derechos reservados.


Webapp que toma el **STL de un producto** y genera el desarrollo plano (dieline) de una
**caja de cartón tipo bandeja + tapa** con un **insert de suspensión por capas** para
inmovilizar el producto, y exporta un **DXF por capas** (corte / pliegue) listo para un
**router CNC**.

Todo corre en el navegador — no hay backend.

## Stack

- **React + Vite + TypeScript**
- **three.js** — parseo y visualización 3D del STL, cálculo del bounding box
- **Maker.js** — construcción paramétrica del dieline y export **DXF/SVG**

## Cómo correr

```bash
npm install
npm run dev      # abre http://localhost:5173
npm run build    # build de producción en dist/
npx tsx scripts/smoke.mts   # test rápido de geometría + export (sin navegador)
```

## Flujo

1. Subís un `.stl` → se calcula el bounding box del producto.
2. Ajustás parámetros (holgura, espesor de cartón, alto de paredes, tapa, agarre del insert).
3. Ves el desarrollo plano en 2D (rojo = corte, azul = pliegue).
4. Descargás **DXF** (capas `CORTE` y `PLIEGUE`) o **SVG**.

## Tipos de caja

- **Bandeja + tapa**: dos piezas (bandeja telescópica + tapa que baja encima).
- **Cofre**: una pieza con la **tapa unida por bisagra** al borde del fondo, con
  labio frontal que cierra.

Opción **doble solapa superior hacia adentro** (frente/fondo): se pliega dos
veces — primero un tramo horizontal de ancho = **espesor del cartón** (para que
la 2ª cara apoye a ras del interior y los pliegues encastren), y luego baja
formando una **doble pared** (rigidez). Las solapas se angostan el espesor por
lado para calzar entre las paredes laterales.

La doble solapa se aplica también a la **tapa** (bandeja+tapa) y al **cofre** (en
la cara opuesta a la bisagra, para no interferir con ella).

Las **puntas de las solapas de esquina** salen **redondeadas** (arcos).

En el **cofre**, la tapa es **una sola pieza** y va agarrada a la **cara más
larga** de la caja (si el ancho supera al largo, la bisagra se ubica en el
lateral); las solapas de esquina quedan en las caras cortas para no interferir.

## Puntos de pegado / broche

En capa **PEGADO** (puntos rojos) se marca dónde va broche o pegado: las 4
solapas de esquina de la bandeja/tapa, el labio del cofre y los pies del insert.

## Piezas que genera

- **Bandeja** (una pieza, paredes plegables + solapas de esquina).
- **Tapa** telescópica (footprint agrandado por espesor + holgura).
- **Insert de retención (una pieza)** — una **bandeja de altura completa** (fondo +
  4 paredes que apoyan en el piso) + un **acordeón de repisas** que cuelga desde el
  borde superior de la pared del fondo hacia adentro. Cada repisa lleva la
  **ventana de su sección**, así el producto **se apoya a distintas alturas**
  (sigue la forma). Cantidad de repisas configurable. Referencia:
  [templatemaker tray insert](https://www.templatemaker.nl/es/tray-insert-rectangle/).

## Orientación

Podés elegir qué eje del STL queda **vertical** (X / Y / Z) y un **giro en el
plano** horizontal. Eso recalcula bounding box, huella y secciones, y reorienta
la vista 3D. El botón **⚙ Óptima** prueba los tres ejes y elige el que
**minimiza el área de lámina** (material).

## Simulador de plegado 3D

La pestaña **Plegado 3D** tiene **dos reproductores independientes** (con su
propio slider / ▶): **Caja** e **Insert**. Ambos pliegan **DESDE PLANO**: a 0% el
cartón está desplegado sobre el piso (como el dieline) y a 100% queda armado.

Se construye con una **jerarquía de paneles con bisagra** (cada panel se pliega
respecto de su padre), por lo que las caras coinciden con el dieline y arrancan
en el piso:

- **Caja**: fondo + 4 paredes + doble solapa (dos etapas: horizontal + doble
  pared). En **bandeja+tapa**, la tapa telescópica pliega y desciende; en
  **cofre**, la tapa (una pieza) va con bisagra en la **cara más larga** y cierra
  girando desde el plano.
- **Insert**: acordeón articulado con las **ventanas cortadas** en cada estante
  (misma sección que corta el dieline). Los pies se pliegan hacia adentro y las
  patas apoyan en el piso.
- **Producto** (STL) suspendido en el centro de la caja.

Nota: las solapas de esquina (glue tabs) no se muestran aún en el 3D.

## Kerf / compensación de herramienta

El parámetro **Kerf / fresa (mm)** achica los huecos (ventanas) `kerf/2` por lado
para que queden a medida tras el corte. El kerf del **contorno exterior** se
setea como **compensación de herramienta en el CAM** (por diámetro de fresa),
que es el flujo estándar; el DXF exporta el perímetro a medida real.

## Convención de capas (para el router)

| Capa DXF  | Significado           | Color |
|-----------|-----------------------|-------|
| `CORTE`   | corte pasante         | rojo (ACI 1) |
| `PLIEGUE` | hendido / plegado     | azul (ACI 5) |
| `MARCA`   | referencia, no cortar | verde (ACI 3) |

## Estructura

```
src/
  lib/
    stl.ts         # parseo STL binario/ASCII + bounding box
    types.ts       # parámetros de caja y defaults
    maker.ts       # helpers Maker.js (líneas/rectángulos con capa)
    dielines.ts    # generadores: bandeja, tapa, puente de suspensión
    assemble.ts    # ubica las piezas en la lámina
    exporters.ts   # DXF (por capas) y SVG
  components/
    Viewer3D.tsx   # visor three.js
    Controls.tsx   # panel de parámetros
  App.tsx
```

## Roadmap / pendientes

- [x] **Insert por contorno real**: la ventana del puente sigue el *convex hull*
      de la huella XY del STL (con offset de agarre configurable), no sólo el
      bounding box. Toggle en la UI.
- [x] **Insert de una sola pieza plegada** (acordeón fan-fold) que sigue la
      **forma 3D** por secciones a distintas alturas.
- [x] **Orientación** del producto (eje vertical X/Y/Z + giro en el plano).
- [x] **Orientación óptima automática** (botón ⚙ Óptima: elige el eje que
      minimiza el área de lámina).
- [x] **Simulador de plegado 3D** realista (bandeja + tapa + insert acordeón
      articulado que cierra apoyando ambos pies en el piso), compartiendo
      geometría con el dieline.
- [x] **Kerf** en huecos (ventanas); perímetro exterior vía tool-comp del CAM.
- [ ] **Kerf del contorno exterior** dentro de la app (offset de loops con
      detección exterior/hueco, tipo Clipper) para no depender del CAM.
- [ ] **Giro óptimo** además del eje (probar rotaciones 0/90 en el plano).
- [x] **Patas al fondo + apriete**: el insert tiene patas plegables hasta el piso
      (con pie de apoyo) que lo paran a la altura justa y aprietan el producto
      contra la tapa (`squeeze` regulable).
- [ ] **Validar cinemática de plegado**: chequear que estantes + patas cierren a
      la altura exacta de la caja al plegar (hoy las longitudes son correctas como
      dieline; falta el simulador de plegado 3D para confirmarlo visualmente).
- [ ] **Pegado/traba** del pie al piso de la bandeja (ranura o autoadhesivo).
- [ ] **Contorno cóncavo**: hoy usamos convex hull por sección (robusto y sin
      "dedos" frágiles). Para concavidades reales haría falta corte mesh-plano
      exacto + simplificación de polígono.
- [ ] **DWG**: el DXF es aceptado por la mayoría de CAM de routers. DWG requiere
      conversión (ODA File Converter o servicio) — agregar como paso opcional.
- [ ] **Nesting** real de piezas para aprovechar la lámina.
- [ ] Compensación de espesor en encastres de la tapa (telescopía real) y
      relieves de pliegue (bleed) según calibre del cartón.
- [ ] Más estilos de caja (RSC, mailer) y de insert (marco, corner-pads).
- [ ] Kerf / offset de herramienta configurable para el router.
- [ ] Plegado 3D animado del dieline para validar antes de cortar.
```
