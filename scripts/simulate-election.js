// Test de bout en bout : simule l'élection secrète des 163 députés (le serveur doit tourner)
//   1er terminal : npm start      2e terminal : npm run simulate
const BASE = process.env.BASE_URL || 'http://localhost:3000/api';

async function api(method, url, token, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* réponse sans JSON */
  }
  return { status: res.status, data };
}

function check(label, ok, extra = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) process.exitCode = 1;
}

(async () => {
  const adminLogin = await api('POST', '/login', null, { email: 'admin@vote.mg', password: 'Admin12345' });
  if (adminLogin.status !== 200) {
    console.log("❌ Connexion administrateur impossible. Le serveur tourne-t-il ? Avez-vous lancé « npm run seed » ?");
    process.exit(1);
  }
  const admin = adminLogin.data.token;

  // 1. Création et ouverture d'un vote secret à choix unique
  const names = ['Candidat A', 'Candidat B', 'Candidat C', 'Candidat D'];
  const created = await api('POST', '/admin/polls', admin, {
    title: `Simulation — Élection du Président de l'Assemblée (${new Date().toLocaleString('fr-FR')})`,
    is_secret: true,
    allow_multiple: false,
    show_results: true,
    options: names.map((label) => ({ label })),
  });
  check('Création du sondage secret', created.status === 201);
  const pollId = created.data.id;

  const detail = await api('GET', `/polls/${pollId}`, admin);
  const optionIds = detail.data.options.map((o) => o.id);
  const expected = new Map(optionIds.map((id) => [id, 0]));

  check('Vote refusé tant que le sondage est fermé', (await api('POST', `/polls/${pollId}/secret-vote`, admin, { option_ids: [optionIds[0]] })).status === 409);
  const opened = await api('POST', `/admin/polls/${pollId}/open`, admin);
  check('Ouverture du vote', opened.data && opened.data.status === 'open');

  // 2. 163 députés votent (par lots de 10 pour aller plus vite)
  const tokens = [];
  for (let start = 1; start <= 163; start += 10) {
    const batch = [];
    for (let i = start; i < start + 10 && i <= 163; i++) {
      const n = String(i).padStart(3, '0');
      batch.push(api('POST', '/login', null, { email: `depute${n}@assemblee.demo`, password: 'Demo12345' }));
    }
    (await Promise.all(batch)).forEach((r) => tokens.push(r.data && r.data.token));
  }
  check('Connexion des 163 députés', tokens.length === 163 && tokens.every(Boolean));

  let accepted = 0;
  for (let start = 0; start < tokens.length; start += 10) {
    const batch = tokens.slice(start, start + 10).map(async (token) => {
      const choice = optionIds[Math.floor(Math.random() * optionIds.length)];
      const r = await api('POST', `/polls/${pollId}/secret-vote`, token, { option_ids: [choice] });
      if (r.status === 201) {
        accepted++;
        expected.set(choice, expected.get(choice) + 1);
      }
    });
    await Promise.all(batch);
  }
  check('163 votes secrets acceptés', accepted === 163, `${accepted} acceptés`);

  // 3. Contrôles de sécurité
  check('Double vote refusé', (await api('POST', `/polls/${pollId}/secret-vote`, tokens[0], { option_ids: [optionIds[1]] })).status === 409);
  check('Option étrangère refusée', (await api('POST', `/polls/${pollId}/secret-vote`, tokens[1], { option_ids: [999999] })).status === 400);
  check('Résultats cachés pendant le vote', (await api('GET', `/polls/${pollId}/results`, tokens[0])).status === 403);
  check("Administration interdite à un député", (await api('GET', `/admin/polls/${pollId}/participation`, tokens[0])).status === 403);

  // 4. Clôture, mixage, dépouillement
  await api('POST', `/admin/polls/${pollId}/close`, admin);
  check('Résultats refusés avant le mixage', (await api('GET', `/polls/${pollId}/results`, admin)).status === 403);
  const mix = await api('POST', `/admin/polls/${pollId}/mix`, admin, {});
  check('Mixage', mix.status === 200, JSON.stringify(mix.data));
  check('Intégrité : bulletins = participations', mix.data && mix.data.integrity_ok === true);
  check('Second mixage refusé', (await api('POST', `/admin/polls/${pollId}/mix`, admin, {})).status === 409);

  const res = await api('GET', `/polls/${pollId}/results`, admin);
  check('Résultats disponibles', res.status === 200);
  let allMatch = true;
  console.log('\nRésultats du dépouillement :');
  for (const r of res.data.results) {
    const exp = expected.get(r.id);
    if (exp !== r.vote_count) allMatch = false;
    console.log(`   ${r.label.padEnd(12)} ${String(r.vote_count).padStart(3)} voix (attendu : ${exp})`);
  }
  check('Les résultats correspondent aux votes émis', allMatch, `${res.data.participants} participants`);

  console.log(process.exitCode ? '\n❌ Des vérifications ont échoué.' : '\n🎉 Toutes les vérifications ont réussi.');
})();
