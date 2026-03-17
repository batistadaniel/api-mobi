import fs from 'node:fs/promises';
import { performance } from "perf_hooks";


// Configurações
const ARQUIVO_ORIGEM = './codigo_parada_v2025.json';
const ARQUIVO_DESTINO = './paradas_df_v2026.json';
const URL_BASE = 'http://localhost:3000/previsao-parada/';
const DELAY_MS = 150;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function iniciarColeta() {
  const inicio = performance.now();

  try {
    // 1. Lê o arquivo original
    const dadosBrutos = await fs.readFile(ARQUIVO_ORIGEM, 'utf-8');
    const paradas = JSON.parse(dadosBrutos);

    console.log(`🚀 Processando ${paradas.length} paradas com Fetch API...`);

    const paradasComCoordenadas = [];
    let processados = 0;

    // 2. Loop de requisições
    for (const parada of paradas) {
      try {
        const response = await fetch(`${URL_BASE}${parada.id}`);

        if (!response.ok) {
          throw new Error(`Status: ${response.status}`);
        }

        const data = await response.json();

        // Extraindo as coordenadas do seu objeto de resposta
        const { lat, lon } = data.coordenadas;

        paradasComCoordenadas.push({
          ...parada,
          lat,
          lon
        });

        processados++;

        if (processados % 80 === 0) {
          console.log(`⏳ Progresso: ${processados}/${paradas.length}...`);
        }

        // Pausa para não sobrecarregar seu Express local
        await delay(DELAY_MS);

      } catch (err) {
        console.error(`⚠️ Erro no ID ${parada.id}: ${err.message}`);
        // Opcional: você pode decidir se quer salvar o item mesmo sem lat/lon
      }
    }

    // 3. Salva o resultado final
    await fs.writeFile(ARQUIVO_DESTINO, JSON.stringify(paradasComCoordenadas, null, 2));

    console.log(`\n✅ Concluído com sucesso!`);
    console.log(`📂 Arquivo salvo: ${ARQUIVO_DESTINO}`);

  } catch (error) {
    console.error("❌ Erro ao processar os arquivos:", error.message);
  }
  const fim = performance.now();
  console.log(`⏱️ Tempo total: ${((fim - inicio) / 1000).toFixed(2)} segundos`);
}

iniciarColeta();