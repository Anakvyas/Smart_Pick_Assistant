const app = require('./app');
const env = require('./config/env');

app.listen(env.port, () => {
  console.log(`Smart Picker backend listening on http://localhost:${env.port}`);
});
