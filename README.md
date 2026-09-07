# Loop / Grid

Loop station desktop quantizado, construído com Electron, React, TypeScript e Web Audio API. O aplicativo usa um relógio único baseado em `AudioContext.currentTime` e agenda captura e reprodução em frames absolutos, mantendo todas as faixas no mesmo grid 4/4.

## Requisitos

- Node.js 18 ou superior
- Um dispositivo de entrada de áudio físico ou virtual

## Executar

```bash
npm install
npm run dev
```

Para gerar o pacote de produção:

```bash
npm run build
```

## Fluxo sincronizado

1. Escolha o dispositivo de entrada.
2. Defina o tempo entre 40 e 240 BPM.
3. Defina o ciclo global em 1, 2, 4, 8 ou 16 compassos.
4. Use **START** para iniciar o relógio, ou arme diretamente uma faixa; ao armar, o relógio inicia automaticamente.
5. Ative **CLICK ON** se quiser ouvir o metrônomo. O relógio continua funcionando mesmo com o click desligado.
6. Pressione **ARM** em uma faixa. Ela entra em `WAITING FOR GRID`, sem reiniciar a barra de fase, e usa o restante do ciclo atual como contagem.
7. A captura começa somente quando o ciclo global atual termina. Todas as faixas usam a mesma fronteira de ciclo, inclusive a primeira.
8. Ao completar um ciclo inteiro de gravação, o próprio `AudioWorklet` troca de captura para reprodução no mesmo frame, sem depender da thread da interface.
9. Use o botão principal da faixa para alternar entre **PAUSE** e **RESUME**. O playhead continua seguindo o grid global e o áudio retorna na fase correta.
10. Use **CLEAR** para limpar o áudio gravado ou o botão **X** no cabeçalho para remover a faixa.
11. Escolha um efeito em **MASTER FX** para processar a soma de todas as faixas. Use **INTERFACE** quando quiser abrir a janela nativa do VST2.
12. Use **EXPORT MP3** para gerar um mixdown de um ciclo completo. Escolha o destino no diálogo de salvamento do sistema.

Enquanto houver uma faixa armada, gravando ou tocando, BPM e duração do ciclo ficam bloqueados. Isso evita alterar a duração física de buffers já gravados e mantém a fase entre todas as faixas. Limpe as faixas para configurar um novo grid.

## Arquitetura de tempo

- `ClockEngine` é a única autoridade de BPM, compassos, posição do ciclo e click track.
- O scheduler usa lookahead curto, mas todo evento carrega um timestamp futuro do `AudioContext`; o tempo do JavaScript nunca é usado como referência musical.
- O relógio emite eventos `downbeat` e `cycle-end`. O `AudioEngine` escuta `cycle-end` e chama `scheduleRecording(trackId, nextDownbeatTime)` com o timestamp da fronteira global.
- O recorder `AudioWorklet` converte o timestamp em `currentFrame`, abre e fecha a captura dentro do quantum de áudio e mantém o loop em memória no domínio de áudio.
- No frame final, o mesmo processor muda para reprodução e começa pela primeira amostra do take. A thread da interface apenas recebe os estados visuais; atrasos de React ou `setTimeout` não alteram o áudio.
- A compensação automática soma a latência informada pela entrada, `baseLatency` e `outputLatency`. O processor desloca o conteúdo por essa quantidade e captura uma pequena cauda após a borda, enquanto a reprodução já está ativa, preservando o fim do take.
- Todas as faixas compartilham o mesmo `ClockEngine`, âncora de ciclo e `AudioContext` de 48 kHz.

## Exportação MP3

- O botão de exportação fica disponível após pelo menos uma faixa completar a gravação.
- Cada worklet entrega uma cópia do loop começando no primeiro frame musical, independentemente da posição atual de reprodução.
- O mixdown respeita o volume individual das faixas e repete buffers menores quando necessário para preencher o maior ciclo.
- Picos acima de `0.98` são normalizados antes da codificação para evitar clipping digital.
- A codificação mono em 192 kbps acontece em um Web Worker, mantendo a interface responsiva.
- Quando um **MASTER FX** está ativo, o mix exportado também passa por uma segunda instância do plugin com os mesmos parâmetros.
- O encoder utilizado é [`@breezystack/lamejs`](https://github.com/shijinyu/lamejs), distribuído sob LGPL-3.0.

## VST2 master

- O host procura plugins VST2 de 64 bits nas pastas comuns do Windows, incluindo `C:\\Program Files\\VstPlugins`.
- O efeito fica depois dos volumes individuais e antes da saída, portanto uma única instância processa todas as faixas.
- O editor fornecido pelo plugin é hospedado em uma janela nativa independente, como em hosts de áudio tradicionais.
- O processamento usa blocos de 2048 frames para atravessar com estabilidade a ponte entre o `AudioWorklet` e o processo principal. Isso adiciona aproximadamente 43 ms de latência a 48 kHz.
- Plugins VST3 ainda não são carregados; o suporte atual é para DLLs VST2.

## Latência e estabilidade

O projeto cria o contexto com:

```ts
new AudioContext({
  sampleRate: 48000,
  latencyHint: 'interactive'
})
```

Em Web Audio, o tamanho do quantum de renderização é normalmente 128 frames e não pode ser definido diretamente pelo aplicativo. O navegador/Electron escolhe o buffer real do dispositivo a partir de `latencyHint` e do driver de áudio.

Para ajustar o comportamento em outras máquinas:

- **Menor latência:** mantenha `latencyHint: 'interactive'`. É a melhor opção para interfaces de áudio estáveis e drivers modernos.
- **Compensação automática:** o valor é recalculado no momento em que a faixa é armada, pois `outputLatency` pode mudar com o dispositivo. A compensação é limitada a 200 ms para evitar valores incorretos reportados por drivers.
- **Mais estabilidade:** teste `latencyHint: 'balanced'` ou um valor numérico, como `0.02`, para solicitar aproximadamente 20 ms. O valor é uma preferência; o resultado real pode ser consultado em `AudioContext.baseLatency` e `outputLatency` quando disponível.
- **Dropouts ou estalos:** aumente primeiro o buffer no painel do driver/ASIO ou no dispositivo virtual. O Electron usa o buffer exposto pelo sistema operacional.
- **Memória dos loops:** cada processor mantém o take em um `Float32Array`. Em 48 kHz mono, um minuto ocupa aproximadamente 11 MB por faixa. Ciclos menores reduzem memória sem alterar a precisão.
- **Sample rate:** mantenha interface, dispositivo e projeto em 48 kHz para evitar resampling. Caso altere, use sempre `context.sampleRate` para converter timestamps em frames.

Um ajuste razoável é começar em modo `interactive`, medir `baseLatency` no console e aumentar o buffer do driver somente se houver dropouts. A precisão do grid permanece baseada em frames mesmo quando a latência de saída aumenta.

## Estrutura

- `src/main/` — janela Electron e permissões de mídia.
- `src/main/vst/` — host VST2 nativo, processamento e janela do editor do plugin.
- `src/preload/` — ponte segura entre processos.
- `src/renderer/audio/ClockEngine.ts` — transporte, grid, metrônomo e eventos musicais.
- `src/renderer/audio/audioEngine.ts` — roteamento, filas quantizadas e reprodução sincronizada.
- `src/renderer/audio/worklets/` — captura por frame e medição de nível.
- `src/renderer/components/` — transporte, timeline global e módulos das faixas.

## Limitações atuais

- Compasso fixo em 4/4.
- Gravação mono.
- `REPLACE` substitui o conteúdo; ainda não há camadas de overdub ou undo.
- O tempo e a duração do ciclo não mudam enquanto houver loops ativos.
