# Clipa — editor de vídeo no navegador

Uma alternativa livre, inspirada nos editores de vídeo mobile (CapCut e similares), feita 100% com HTML, CSS e JavaScript puro — sem dependências, sem backend e sem enviar seus arquivos para nenhum servidor.

![fluxo](https://img.shields.io/badge/100%25-local-7c5cff) ![sem dependências](https://img.shields.io/badge/dependências-0-22d3ee)

## Como rodar

O app usa **módulos ES**, então precisa ser servido por HTTP (abrir o `index.html` com `file://` não funciona).

```bash
cd clipa
python3 -m http.server 5173
# abra http://localhost:5173
```

Também funciona em qualquer servidor estático (Vercel, Netlify, GitHub Pages, Nginx…). Basta publicar a pasta `clipa/`.

Requisitos: Chrome, Edge, Firefox ou Safari atualizados.

## O que dá para fazer

**Linha do tempo profissional**
- 4 faixas prontas: texto, sobreposição, vídeo principal e áudio (+ faixas extras de sobreposição).
- Arrastar e soltar clipes, mover entre faixas compatíveis, aparar pelas alças laterais, dividir no cursor, duplicar e excluir.
- Encaixe magnético nas bordas de outros clipes e na agulha, zoom da régua (Ctrl + scroll) e régua com escalas adaptativas.

**Edição**
- Velocidade de 0,25× a 3× por clipe (vídeo e áudio).
- Encaixe do vídeo: preencher (cortando), conter (com barras), esticar ou tamanho original.
- Transformações: escala, rotação, opacidade, posição X/Y e controle direto sobre o vídeo (arrastar para mover, alça para redimensionar).
- Ajustes de imagem: brilho, contraste, saturação, matiz, desfoque e vinheta.
- 10 filtros prontos (P&B, sépia, cinema, quente, frio, vintage, vívido e mais).

**Textos**
- 8 modelos prontos (título, subtítulo, legenda, caixa colorida, contornado, créditos, lower third, chamada).
- Controle de fonte, tamanho, peso, cor, fundo, borda, sombra, alinhamento, largura máxima e espaçamento.
- Posicionamento por sliders ou arrastando o texto na prévia.

**Animações**
- 9 animações de entrada e saída por clipe (fade, subir, descer, deslizar, zoom in/out, pop, girar) com duração ajustável.

**Áudio**
- Cada clipe de áudio/vídeo tem volume, velocidade e a faixa pode ser silenciada.
- Forma de onda desenhada na linha do tempo a partir da decodificação real do arquivo.

**Exportação**
- Gravação real do projeto (vídeo + áudio) usando `MediaRecorder` e `canvas.captureStream`, com resolução (Original/1080p/720p/480p) e qualidade ajustáveis.
- O arquivo é gerado localmente no navegador e baixado automaticamente. Prévia do resultado dentro do app.

**Conforto**
- Desfazer/refazer (até 80 passos), atalhos de teclado, avisos de importação, arrastar arquivos para qualquer lugar da janela, prévia com tela cheia.

## Atalhos

| Tecla | Ação |
| --- | --- |
| Espaço | Reproduzir / pausar |
| S | Dividir o clipe no cursor |
| Ctrl + D | Duplicar clipe |
| Delete | Excluir clipe |
| Ctrl + Z / Ctrl + Shift + Z | Desfazer / refazer |
| ← / → | Um quadro |
| Shift + ← / → | Um segundo |
| Ctrl + scroll | Zoom da linha do tempo |
| Ctrl + O / Ctrl + E | Importar / exportar |
| Esc | Limpar seleção |

## Formatos suportados

A importação depende do que o seu navegador decodifica. Na prática:

- **Vídeo:** MP4 (H.264), WebM, OGG; MOV/MKV só quando o navegador suporta o contêiner/codec.
- **Áudio:** MP3, WAV, M4A/AAC, OGG/Opus, FLAC (conforme navegador).
- **Imagem:** JPG, PNG, GIF, WebP, AVIF, BMP.

A exportação gera **WebM (VP9/VP8 + Opus)** na maioria dos navegadores (ou MP4, quando o navegador oferece suporte a `MediaRecorder` com H.264). Para virar MP4 universal, converta com `ffmpeg -i saida.webm -c:v libx264 -c:a aac saida.mp4`.

## Limitações conhecidas

- **Exportação em tempo real:** grava enquanto o vídeo roda, então um vídeo de 2 minutos leva ~2 minutos para exportar. Não há renderização offline quadro a quadro nesta versão.
- **Projeto em memória:** recarregar a página perde a linha do tempo (os arquivos originais nunca saem do seu computador). Salvar/abrir `.clipa` está na lista de próximos passos.
- Não há transições entre clipes, keyframes, chroma key, gravação de tela ou biblioteca de músicas.
- A reprodução fica mais leve em resoluções menores — para projetos longos, exporte em 720p.

## Estrutura

```
clipa/
├── index.html
├── css/styles.css
└── js/
    ├── app.js        # bootstrap, topbar, atalhos, toasts, drop global
    ├── store.js      # modelo do projeto, histórico, operações nos clipes
    ├── media.js      # importação, miniaturas, forma de onda, elementos de mídia
    ├── audio.js      # roteamento de áudio (Web Audio) e captura do stream
    ├── render.js     # compositor do quadro (vídeo, imagem, texto, filtros, animações)
    ├── preview.js    # canvas de prévia, controles de transporte, caixa de seleção
    ├── timeline.js   # régua, faixas, clipes, arrastar, aparar, dividir
    ├── panel.js      # inspetor de propriedades (projeto e clipes)
    ├── assets.js     # biblioteca de mídia, modelos de texto e filtros
    ├── transport.js  # relógio de reprodução e sincronização das mídias
    ├── export.js     # modal e pipeline de exportação
    ├── bus.js        # barramento de eventos
    └── util.js       # helpers (DOM, formatação, easing)
```

## Créditos

Interface e engine escritas do zero para este repositório. Nenhum código, marca ou recurso do CapCut foi copiado — o objetivo é apenas oferecer um editor de vídeo simples e gratuito que roda no navegador.
