/* ==========================================================
   SIGT — SAN SALVADOR SUR
   lightbox.js  —  Visor de fotografías a pantalla completa

   Al tocar cualquier fotografía (en los popups del mapa o en las
   miniaturas de un formulario) se abre ampliada, con navegación
   entre las fotos del mismo registro.

   Se engancha por delegación en `document` porque los popups de
   Leaflet se crean y destruyen continuamente: registrar oyentes
   sobre cada imagen se perdería en cuanto el popup se cierra.
   ========================================================== */

import { safeUrl } from "../utils/security.js";

const SELECTOR_FOTO = ".registry-popup-photo, .registry-photo-thumb img";

class Lightbox {
    constructor() {
        this.el = null;
        this.imagenes = [];
        this.indice = 0;
        this.touchInicio = null;
    }

    construir() {
        if (this.el) return;

        const cont = document.createElement("div");
        cont.id = "sigtLightbox";
        cont.className = "sigt-lightbox";
        cont.setAttribute("role", "dialog");
        cont.setAttribute("aria-label", "Fotografía ampliada");
        cont.innerHTML = `
            <button class="sigt-lb-cerrar" aria-label="Cerrar">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <button class="sigt-lb-nav prev" aria-label="Anterior">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <figure class="sigt-lb-figura">
                <img class="sigt-lb-img" alt="Fotografía del registro">
            </figure>
            <button class="sigt-lb-nav next" aria-label="Siguiente">
                <i class="fa-solid fa-chevron-right"></i>
            </button>
            <div class="sigt-lb-contador"></div>
        `;
        document.body.appendChild(cont);
        this.el = cont;

        cont.querySelector(".sigt-lb-cerrar").addEventListener("click", () => this.cerrar());
        cont.querySelector(".prev").addEventListener("click", (e) => { e.stopPropagation(); this.mover(-1); });
        cont.querySelector(".next").addEventListener("click", (e) => { e.stopPropagation(); this.mover(1); });

        // Tocar el fondo cierra; tocar la imagen no.
        cont.addEventListener("click", (e) => { if (e.target === cont) this.cerrar(); });
        cont.querySelector(".sigt-lb-figura").addEventListener("click", (e) => {
            if (e.target.tagName !== "IMG") this.cerrar();
        });

        // Deslizar con el dedo para cambiar de foto
        cont.addEventListener("touchstart", (e) => {
            this.touchInicio = e.changedTouches[0].clientX;
        }, { passive: true });

        cont.addEventListener("touchend", (e) => {
            if (this.touchInicio === null) return;
            const delta = e.changedTouches[0].clientX - this.touchInicio;
            if (Math.abs(delta) > 50) this.mover(delta < 0 ? 1 : -1);
            this.touchInicio = null;
        }, { passive: true });

        document.addEventListener("keydown", (e) => {
            if (!this.abierto()) return;
            if (e.key === "Escape") this.cerrar();
            else if (e.key === "ArrowLeft") this.mover(-1);
            else if (e.key === "ArrowRight") this.mover(1);
        });
    }

    abierto() {
        return this.el?.classList.contains("active");
    }

    abrir(imagenes, indice = 0) {
        const validas = imagenes.map(safeUrl).filter(Boolean);
        if (!validas.length) return;

        this.construir();
        this.imagenes = validas;
        this.indice = Math.max(0, Math.min(indice, validas.length - 1));

        this.pintar();
        this.el.classList.add("active");
        document.body.classList.add("sigt-lightbox-abierto");
    }

    pintar() {
        const img = this.el.querySelector(".sigt-lb-img");
        img.src = this.imagenes[this.indice];

        const varias = this.imagenes.length > 1;
        this.el.querySelector(".prev").style.display = varias ? "flex" : "none";
        this.el.querySelector(".next").style.display = varias ? "flex" : "none";

        const contador = this.el.querySelector(".sigt-lb-contador");
        contador.style.display = varias ? "block" : "none";
        contador.textContent = `${this.indice + 1} / ${this.imagenes.length}`;
    }

    mover(paso) {
        if (this.imagenes.length < 2) return;
        this.indice = (this.indice + paso + this.imagenes.length) % this.imagenes.length;
        this.pintar();
    }

    cerrar() {
        if (!this.el) return;
        this.el.classList.remove("active");
        this.el.querySelector(".sigt-lb-img").src = "";
        document.body.classList.remove("sigt-lightbox-abierto");
    }
}

const lightbox = new Lightbox();

/**
 * Activa el visor para toda la aplicación. Basta llamarlo una vez.
 */
export function activarLightbox() {
    if (document.body.dataset.lightbox === "1") return;
    document.body.dataset.lightbox = "1";

    document.addEventListener("click", (e) => {
        const img = e.target.closest?.(SELECTOR_FOTO);
        if (!img) return;

        // Al pulsar la "x" de una miniatura se elimina la foto: no ampliar.
        if (e.target.closest(".registry-photo-remove")) return;

        e.preventDefault();
        e.stopPropagation();

        // Reunir las fotos hermanas para poder pasar de una a otra
        const galeria = img.closest(".registry-popup-gallery, .registry-photo-preview");
        const fotos = galeria
            ? [...galeria.querySelectorAll("img")].map(i => i.src)
            : [img.src];
        const indice = Math.max(0, fotos.indexOf(img.src));

        lightbox.abrir(fotos, indice);
    });
}

export { lightbox };
