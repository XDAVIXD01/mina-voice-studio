import { mkdir, readFile, writeFile } from "node:fs/promises";
import pngToIco from "png-to-ico";

await mkdir(new URL("./build/", import.meta.url), { recursive: true });
const png = await readFile(new URL("./assets/mina-icon.png", import.meta.url));
const ico = await pngToIco(png);
await writeFile(new URL("./build/icon.ico", import.meta.url), ico);
console.log("Icono de Windows generado en alta resolución.");
