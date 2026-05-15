const chartInstances = {};

function makeRainChart(id, labels, values, labelText) {
  if (chartInstances[id]) chartInstances[id].destroy();
  const ctx = document.getElementById(id).getContext('2d');
  chartInstances[id] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: labelText,
        data: values,
        backgroundColor: 'rgba(33, 150, 211, 0.7)',
        borderColor: 'rgba(26, 111, 168, 1)',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${Math.round(ctx.raw * 10) / 10} mm`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => `${v} mm` }
        }
      }
    }
  });
}

async function fetchRainCharts() {
  try {
    const res = await fetch('/api/rain/history');
    const data = await res.json();

    makeRainChart('chart-60min',
      data.last60.map(r => r.minute),
      data.last60.map(r => Math.round(r.rain_mm * 10) / 10),
      'Rain rate (mm/hr)'
    );
    makeRainChart('chart-today',
      data.todayByHour.map(r => `${r.hour}:00`),
      data.todayByHour.map(r => Math.round(r.rain_mm * 10) / 10),
      'Rainfall (mm)'
    );
    makeRainChart('chart-7days',
      data.last7.map(r => r.day.slice(5)),
      data.last7.map(r => Math.round(r.rain_mm * 10) / 10),
      'Rainfall (mm)'
    );
    makeRainChart('chart-30days',
      data.last30.map(r => r.day.slice(5)),
      data.last30.map(r => Math.round(r.rain_mm * 10) / 10),
      'Rainfall (mm)'
    );
    makeRainChart('chart-ytd',
      data.ytdByMonth.map(r => r.month.slice(5)),
      data.ytdByMonth.map(r => Math.round(r.rain_mm * 10) / 10),
      'Rainfall (mm)'
    );
  } catch (err) {
    console.error('Failed to fetch rain charts:', err);
  }
}

fetchRainCharts();
setInterval(fetchRainCharts, 60000);
