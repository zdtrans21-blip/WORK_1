require('dotenv').config();
const express = require('express');
const { handleActivityRequest } = require('./handler');
const { handleRecalcRequest } = require('./recalcHandler');

const app = express();
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.json({ limit: '5mb' }));

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'psi-kolodka-activity' });
});

app.post('/handler', (req, res) => {
  handleActivityRequest(req, res).catch((err) => {
    console.error('[psi_kolodka_recognizer] unhandled handler error:', err);
  });
});

app.post('/recalc-handler', (req, res) => {
  handleRecalcRequest(req, res).catch((err) => {
    console.error('[psi_kolodka_recalc_deviation] unhandled handler error:', err);
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`psi-kolodka-activity listening on port ${port}`);
});
