import express from 'express';
import cors from 'cors';
import { performance } from "perf_hooks";

const app = express();
app.use(cors());

const PORT = 3000;

app.get('/linhas', async (req, res) => {
  const inicio = performance.now();

  const linhas = 'https://mobilibus.com/api/routes?origin=web&project_id=313'; // mostra todas as linhas
  // const linhaDetalhada = `https://mobilibus.com/api/timetable?origin=web&v=2&project_id=313&route_id=${route_id}`; // mostra os detalhes de uma linha específica

  try {
    const responseLinhas = await fetch(linhas);
    const linhasData = await responseLinhas.json();

    const linhasFormatadas = linhasData.map(linha => ({
      route_id: linha.routeId,
      numero: linha.shortName,
      nome: linha.longName,
      cor_operadora: linha.color,
      preco: linha.price,
    }));

    const fim = (performance.now() - inicio).toFixed(2);

    res.json({
      tempo_execucao: `${fim}ms`,
      total_linhas: linhasFormatadas.length,
      linhas: linhasFormatadas,
    });

  } catch (error) {
    console.error('Erro ao buscar dados da API:', error);
    res.status(500).json({ error: 'Erro ao buscar dados da API' });
  }
});


app.get('/linha/:numero', async (req, res) => {
  const inicio = performance.now();
  const numeroBusca = req.params.numero || req.params.nome;
  // const nomeBusca = re

  try {
    // 1. Busca lista local para achar o route_id
    const resLista = await fetch('http://localhost:3000/linhas');
    if (!resLista.ok) throw new Error('Erro ao acessar lista local');
    const dataGeral = await resLista.json();

    let linhaBase = dataGeral.linhas.find(l => l.numero === numeroBusca || l.nome.toLocaleLowerCase() === numeroBusca);
    if (numeroBusca === "ceilandia") {
      linhaBase = dataGeral.linhas.find(l => l.nome.toLocaleLowerCase() === "ceilândia");
    }
    // --- LÓGICA DE CORREÇÃO ---
    if (!linhaBase) {
      let match = null;
      if (numeroBusca.includes(".")) {
        const [parte1, parte2] = numeroBusca.split(".");
        const parte1Padded = parte1.padStart(4 - parte2.length, "0");
        const tentativaComPonto = `${parte1Padded}.${parte2}`;
        match = dataGeral.linhas.find(l => l.numero === tentativaComPonto);
      }
      if (!match) {
        const buscaLimpa = numeroBusca.replace(/\./g, "").padStart(4, "0");
        match = dataGeral.linhas.find(l =>
          (l.numero || "").replace(/\./g, "").padStart(4, "0") === buscaLimpa
        );
      }
      if (match) return res.redirect(`/linha/${match.numero}`);
      return res.status(404).json({ mensagem: "Linha não encontrada no sistema oficial." });
    }

    // 2. Busca o Horário e IDs das Viagens
    const route_id = linhaBase.route_id;
    const urlTimetable = `https://mobilibus.com/api/timetable?origin=web&v=2&project_id=313&route_id=${route_id}`;
    const resTimetable = await fetch(urlTimetable);
    if (!resTimetable.ok) throw new Error('Erro ao acessar Mobilibus Timetable');
    const m = await resTimetable.json();

    // 3. Busca Detalhes da Viagem e Veículos em paralelo para cada trip
    const promessas = m.timetable.trips.map(trip =>
      Promise.all([
        fetch(`https://mobilibus.com/api/trip-details?origin=web&v=2&trip_id=${trip.tripId}`).then(r => r.json()).catch(() => null),
        fetch(`https://mobilibus.com/api/vehicles?origin=web&trip_id=${trip.tripId}&route_id=${route_id}`).then(r => r.json()).catch(() => [])
      ])
    );

    const resultados = await Promise.all(promessas);

    // 4. Formatação de Viagens (incluindo Veículos)
    const viagensFormatadas = m.timetable.trips.map((t, index) => {
      const [detalhe, veiculos] = resultados[index];

      // Função auxiliar para formatar os segundos
      const formatarDelay = (segundos) => {
        const abs = Math.abs(segundos);
        const m = Math.floor(abs / 60);
        const s = abs % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      };

      return {
        sentido: t.directionId === 0 ? "Ida" : "Volta",
        directionId: t.directionId,
        id_viagem: t.tripId,
        destino: t.tripDesc,
        shape: detalhe ? detalhe.shape : null,
        veiculos_operando: veiculos.map(v => ({
          prefixo: v.vehicleId,
          horario_inicio: v.startTime,
          ultima_atualizacao: v.positionTime,
          localizacao: { lat: v.lat, lng: v.lng },
          progresso_percentual: v.percTravelled,
          atraso_segundos: v.delay,
          // Usando a lógica que verificamos (mantendo a sua original, 
          // ou invertendo se você preferir basear no sinal que descobrimos)
          status: v.delay > 0 ? "Atrasado" : (v.delay < 0 ? "Adiantado" : "No horário"),
          delay_formatado: formatarDelay(v.delay), // <--- AQUI A NOVA PROPRIEDADE
          sequencia_parada: v.seq
        }))
      };
    });

    // 5. Formatação da Grade Horária
    const timetableFormatado = m.timetable.directions.map(direcao => ({
      sentido: direcao.directionId === 0 ? "Ida" : "Volta",
      ponto_partida: direcao.desc,
      servicos: direcao.services.map(s => ({
        dias: s.desc,
        partidas: s.departures.map(d => d.dep)
      }))
    }));

    // 6. Formatação dos Itinerários (pontos de parada)
    const itinerariosFormatados = m.timetable.trips.map((t, index) => {
      const detalhe = resultados[index][0];
      return {
        id_viagem: t.tripId,
        sentido: t.directionId === 0 ? "Ida" : "Volta",
        paradas: detalhe ? detalhe.stops.map((s, i) => ({
          id: i + 1,
          nome: s.name,
          coordenadas: { lat: s.lat, lng: s.lng },
          previsao_chegada_segundos: s.int
        })) : []
      };
    });

    const fim = (performance.now() - inicio).toFixed(2);

    // 7. Resposta Final
    res.json({
      tempo_execucao: `${fim}ms`,
      route_id: m.routeId,
      numero: m.shortName,
      nome: m.longName,
      cor_operadora: m.color,
      preco: m.price,
      viagens: viagensFormatadas.sort((a, b) => a.directionId - b.directionId),
      grade_horaria: timetableFormatado.sort((a, b) => (a.sentido === "Ida" ? -1 : 1)),
      itinerarios: itinerariosFormatados.sort((a, b) => (a.sentido === "Ida" ? -1 : 1))
    });

  } catch (error) {
    console.error("Erro na API:", error);
    res.status(500).json({ erro: "Erro ao processar itinerário da linha." });
  }
});


app.get('/previsao-parada/:stop_hash', async (req, res) => {
  const inicio = performance.now();
  const { stop_hash } = req.params;
  const url = `https://mobilibus.com/api/departures?v=2&stop_hash=${stop_hash}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Erro ao buscar dados na Mobilibus' });
    }

    const data = await response.json();
    const stopInfo = data.stops && data.stops[0] ? data.stops[0] : {};

    // 1. Criamos um mapa de alertas indexado pelo routeId para acesso rápido
    // Caso existam vários alertas para a mesma rota, este código agrupa em um array
    const mapaAlertas = (data.alerts || []).reduce((acc, alert) => {
      if (!acc[alert.routeId]) acc[alert.routeId] = [];
      acc[alert.routeId].push({
        titulo: alert.header,
        detalhes: alert.details,
        efeito: alert.effect === "SIGNIFICANT_DELAYS" ? "Atrasos Significativos" : alert.effect
      });
      return acc;
    }, {});

    // 2. Mapeamos as viagens e injetamos o alerta se houver match no routeId
    const partidasFormatadas = data.trips.map(trip => {
      return {
        numero: trip.shortName,
        nome: trip.longName,
        destino: trip.headsign,
        sentido: trip.directionId === 0 ? "Indo" : "Voltando",
        cor: trip.color,
        sequenciaParadaLinha: trip.stopSequence,
        // Injetamos o alerta aqui se o routeId da trip existir no nosso mapa
        alertas: mapaAlertas[trip.routeId] || [], 
        previsoes: trip.departures.map(dep => ({
          horario: dep.time.substring(0, 5),
          previsaoParaAmanha: dep.nextDay,
          prefixoVeiculo: dep.vehicleId || "N/A",
          paradaAtualVeiculo: dep.stopSequence || "N/A"
        }))
      };
    });

    const fim = (performance.now() - inicio).toFixed(2);
    
    const resultado = {
      tempo_execucao: `${fim}ms`,
      id: stopInfo.stopId,
      nome: stopInfo.name,
      coordenadas: {
        lat: stopInfo.lat,
        lon: stopInfo.lon
      },
      partidas: partidasFormatadas
    };

    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});


// backup da função de previsão de parada com cache local para evitar múltiplas chamadas à API da Mobilibus para a mesma linha em um curto período de tempo. O cache é implementado usando um Map, onde a chave é o número da linha e o valor é a resposta da API. Antes de fazer uma nova chamada, a função verifica se a informação já está presente no cache e, se estiver, retorna essa informação diretamente, economizando tempo e recursos.
// const cacheLinhas = new Map();

// async function getInfoLinha(numeroLinha) {
//   if (cacheLinhas.has(numeroLinha)) return cacheLinhas.get(numeroLinha);

//   try {
//     const res = await fetch(`http://localhost:3000/linha/${numeroLinha}`);
//     if (!res.ok) return null;
//     const data = await res.json();
//     cacheLinhas.set(numeroLinha, data);
//     return data;
//   } catch (e) {
//     return null;
//   }
// }

// app.get('/previsao-parada/:stop_hash', async (req, res) => {
//   const inicio = performance.now();

//   const { stop_hash } = req.params;
//   const url = `https://mobilibus.com/api/departures?v=2&stop_hash=${stop_hash}`;

//   try {
//     const response = await fetch(url);
//     if (!response.ok) return res.status(response.status).json({ error: 'Erro na Mobilibus' });
//     const data = await response.json();

//     const stopInfo = data.stops?.[0] || {};

//     // Usamos Promise.all para processar as linhas em paralelo
//     const partidasFormatadas = await Promise.all(data.trips.map(async (trip) => {
//       // Busca a info correta da linha
//       const infoLinha = await getInfoLinha(trip.shortName);

//       // Procura a viagem correspondente no seu endpoint pelo directionId
//       const viagemInfo = infoLinha?.viagens.find(v => v.directionId === trip.directionId);

//       return {
//         numero: trip.shortName,
//         nome: infoLinha?.nome || trip.longName, // Prioriza o seu endpoint
//         destino: viagemInfo?.destino || trip.headsign, // Usa o destino do seu endpoint
//         sentido: trip.directionId === 0 ? "Indo" : "Voltando",
//         cor: trip.color,
//         sequenciaParadaLinha: trip.stopSequence,
//         previsoes: trip.departures.map(dep => ({
//           horario: dep.time.substring(0, 5),
//           previsaoParaAmanha: dep.nextDay,
//           prefixoVeiculo: dep.vehicleId || "N/A",
//           paradaAtualVeiculo: dep.stopSequence || "N/A"
//         }))
//       };
//     }));

//     const fim = (performance.now() - inicio).toFixed(2);

//     res.json({
//       tempo_execucao: `${fim}ms`,
//       id: stopInfo.stopId,
//       nome: stopInfo.name,
//       coordenadas: { lat: stopInfo.lat, lon: stopInfo.lon },
//       partidas: partidasFormatadas
//     });

//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: 'Erro interno' });
//   }
// });

// app.get('/veiculo/:numero_linha', (req, res) => {

// });

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});