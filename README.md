# MINA Voice Studio

Aplicación independiente de Windows para generar voz a partir de un texto y un audio de referencia. No usa Discord, tokens, Colab ni el proyecto de MINA.

**[Descargar para Windows](https://github.com/XDAVIXD01/mina-voice-studio/releases/latest)** · [Código fuente](https://github.com/XDAVIXD01/mina-voice-studio)

En la sección Releases elige `Instalador-MINA-Voice-Studio-1.0.0.exe` para instalar, o `MINA-Voice-Studio-Portable-1.0.0.exe` para ejecutar sin instalar la interfaz. Ambas ediciones guardan el motor y los audios en la carpeta de datos del usuario; la edición portátil también necesita preparar el motor en el primer uso.

## Instalación y uso

1. Ejecuta `Instalador-MINA-Voice-Studio-1.0.0.exe` y abre el acceso del escritorio.
2. Elige GPU NVIDIA o CPU. Pulsa **Preparar motor**: descarga Python, PyTorch y las dependencias dentro de los datos propios de la aplicación. Necesita internet y varios GB de disco; reserva al menos 12 GB para NVIDIA.
3. Carga una grabación con una sola voz, sin música y de al menos 3 segundos. La app prepara hasta los primeros 30 segundos. La calidad depende de la grabación; 10–20 segundos limpios suelen ser una referencia más útil que un audio ruidoso largo.
4. Escribe el texto, elige idioma y expresividad y pulsa **Generar voz**. La primera generación descarga los modelos y puede tardar varios minutos.
5. Reproduce el resultado y pulsa **Guardar WAV**. Los audios recientes también se conservan en la biblioteca local.

La aplicación utiliza Chatterbox Multilingual, Python, PyTorch y FFmpeg. La modalidad CPU funciona sin tarjeta NVIDIA pero puede ser considerablemente más lenta. La modalidad CUDA requiere una GPU NVIDIA compatible y controlador actualizado. El programa se distribuye para Windows x64; no se ha validado en otras plataformas.

## Datos y recursos

Todo se guarda en `%APPDATA%\MINA Voice Studio`: `references`, `generated`, `models`, `voice-engine`, `python`, `settings.json` y `engine.log`.

La referencia no se envía a un servidor de generación. La conexión inicial descarga software y pesos desde GitHub, PyPI, PyTorch y Hugging Face. Después de completar las descargas, la síntesis se realiza localmente; ciertos componentes pueden comprobar actualizaciones de caché de modelos al cargar.

El motor se mantiene cargado entre generaciones y se descarga después de dos minutos sin actividad. También puedes pulsar **Liberar memoria** o cerrar la aplicación. **Cancelar** interrumpe el motor; el siguiente intento lo carga nuevamente. Los archivos WAV terminados se conservan aunque cierres la app.

Los instaladores no incluyen grabaciones personales, voces preconfiguradas ni credenciales. Incluyen la aplicación, FFmpeg y el código del motor; el entorno Python se prepara por usuario en la primera configuración. No es necesario tener Node.js o Python instalados previamente.

## Desarrollo

Requiere Node.js 22 o superior. Para crear los ejecutables de Windows, compila en Windows x64. Clona el repositorio y ejecuta:

```text
git clone https://github.com/XDAVIXD01/mina-voice-studio.git
cd mina-voice-studio
```

```text
npm install
npm test
npm start
npm run dist
```

En desarrollo, **Usar Python ya preparado** permite seleccionar un intérprete que tenga Chatterbox 0.1.7, PyTorch compatible, soundfile y sus dependencias. El instalador estándar prepara su propio entorno y no depende de esa opción.

`main.cjs` gestiona las ventanas y archivos; `backend.cjs` controla la referencia y el proceso de voz; `engine/worker.py` realiza la inferencia. Las pruebas cubren importación, recuperación del proceso y cancelación durante la carga. La opción de CLI `--self-test=<ruta>` junto con `--test-reference=<audio>` genera y decodifica un WAV real en un entorno ya preparado.

## Componentes de terceros

- [Chatterbox](https://github.com/resemble-ai/chatterbox), licencia MIT.
- [PyTorch](https://pytorch.org/), [uv](https://github.com/astral-sh/uv), [Electron](https://www.electronjs.org/).
- FFmpeg proviene de [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static); su aviso de licencia y referencia de compilación se incluyen en `resources/licenses` de la instalación. Consulta el README de la compilación para el código fuente correspondiente.

La preparación fija PyTorch y torchaudio 2.8.0 y adapta la instalación de Chatterbox 0.1.7 para usarlos con CUDA 12.8 en GPU recientes. La compatibilidad se verifica con una generación real en el equipo de desarrollo; equipos y controladores distintos pueden requerir ajustes.

## Licencia

El código propio de este proyecto se distribuye bajo la licencia MIT. Las dependencias y los modelos conservan sus respectivas licencias. Consulta [LICENSE](LICENSE).
