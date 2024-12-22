const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const xml2js = require('xml2js');
const path = require('path');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');

const app = express();
//const port = 3000;
const port = process.env.PORT || 3000; // Usa la porta fornita da Render o 3000 in locale


const cors = require('cors');

// Configurazione generica (aperta a tutti)
app.use(cors());

const corsOptions = {
  origin: 'https://upanddown-lth.onrender.com', // Sostituisci con il dominio del tuo client
  methods: 'GET,POST',
  allowedHeaders: 'Content-Type,Authorization',
};

app.use(cors(corsOptions));

require('dotenv').config();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const xmlFilePath = path.join(__dirname, 'DB_UpAndDown.xml');

process.env.LC_ALL = 'it_IT';
process.env.LANG = 'it_IT';
process.env.LANGUAGE = 'it_IT';

app.use((req, res, next) => {
  console.log(`[LOG] Richiesta: ${req.method} ${req.url}`);
  console.log(`[LOG] Intestazioni:`, req.headers);
  next();
});

///////////////////////////////

//console.log("ENCRYPTION_KEY:", process.env.ENCRYPTION_KEY);
//console.log("IV:", process.env.IV);
//console.log("ENCRYPTED_PASSWORD:", process.env.ENCRYPTED_PASSWORD);

// Recupera la chiave e l'IV dal file .env

const encryptionKey = process.env.ENCRYPTION_KEY;
const iv = process.env.IV;
const encryptedPassword = process.env.ENCRYPTED_PASSWORD;


function encryptCF(CF) {
  const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(process.env.ENCRYPTION_KEY, 'utf-8'),
      Buffer.from(process.env.IV, 'utf-8')
  );
  let encrypted = cipher.update(CF, 'utf8', 'base64');
  encrypted += cipher.final('base64'); // Base64 per l'URL
  return encrypted;
}

function decryptCF(encryptedCF) {
  const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(process.env.ENCRYPTION_KEY, 'utf-8'),
      Buffer.from(process.env.IV, 'utf-8')
  );
  let decrypted = decipher.update(encryptedCF, 'base64', 'utf8'); // Base64 come input
  decrypted += decipher.final('utf8');
  return decrypted;
}

console.log(encryptCF("PRNSTF88S01A326C"));
console.log(decryptCF("0B9t4wCJEmYcQZjpWlgmiCofc0SUaXbukW+HD6ojTjc="));

// Configura le rotte
app.get('/', (req, res) => {
    res.send('Server attivo!');
});

// Ascolta su tutte le interfacce
app.listen(port, '0.0.0.0', () => {
    console.log(`Server in esecuzione su http://0.0.0.0:${port}`);
});

// Controlla che le variabili siano definite
if (!encryptionKey || encryptionKey.length !== 32) {
    throw new Error("La chiave di crittografia (ENCRYPTION_KEY) deve essere definita e lunga 32 caratteri.");
}

if (!iv || iv.length !== 16) {
    throw new Error("L'IV (IV) deve essere definito e lungo 16 caratteri.");
}

if (!encryptedPassword) {
    throw new Error("La password criptata (ENCRYPTED_PASSWORD) non è definita nel file .env.");
}

// Funzione per decriptare la password con AES
function decryptPasswordAES(encryptedPassword) {
    try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey, 'utf-8'), Buffer.from(iv, 'utf-8'));
        let decrypted = decipher.update(encryptedPassword, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        console.error("Errore nella decriptazione della password:", err.message);
        throw new Error("Impossibile decriptare la password.");
    }
}

// Decripta la password
let decryptedPassword;
try {
    decryptedPassword = decryptPasswordAES(encryptedPassword);
    ///console.log("Password decriptata con successo:", decryptedPassword);
} catch (err) {
    console.error(err.message);
    process.exit(1); // Arresta l'applicazione se la decriptazione fallisce
}

///console.log("Lunghezza ENCRYPTION_KEY:", encryptionKey.length);
//////////////////////////////////




// Inizializza il database
const db = new sqlite3.Database('UpAndDown.db');

db.serialize(() => {
  // Creazione della tabella Anagrafica
  db.run(`
    CREATE TABLE IF NOT EXISTS Anagrafica (
      ID INTEGER PRIMARY KEY AUTOINCREMENT,
      Nome TEXT,
      Cognome TEXT,
      Sesso TEXT,
      DataNascita TEXT,
      LuogoNascita TEXT,
      CF TEXT UNIQUE,
      Indirizzo TEXT,
      Comune TEXT,
      email TEXT,
      telefono TEXT,
      DataTesseramento TEXT,
      DataUltimoUpAndDown TEXT,
      DataUltimoUISP TEXT,
      IngressiBoulder INTEGER,
      IngressiLudica INTEGER,
      Foto BLOB,
      LastModified TEXT DEFAULT (datetime('now'))
    )
  `);

  console.log("Tabella Anagrafica creata o già esistente.");

  // Creazione della tabella Prodotti
  db.run(`
    CREATE TABLE IF NOT EXISTS Prodotti (
      idProdotto INTEGER PRIMARY KEY AUTOINCREMENT,
      Prodotto TEXT NOT NULL,
      PrezzoUnitario REAL NOT NULL,
      LastModified TEXT DEFAULT (datetime('now'))
    )
        `);

  console.log("Tabella Prodotti creata o già esistente.");

  // Creazione della tabella Acquisti
  db.run(`
    CREATE TABLE IF NOT EXISTS Acquisti (
      idAcquisto INTEGER PRIMARY KEY AUTOINCREMENT,
      CF TEXT NOT NULL,
      idProdotto INTEGER NOT NULL,
      Prodotto TEXT NOT NULL,
      PrezzoUnitario REAL NOT NULL,
      Quantità INTEGER NOT NULL,
      LastModified TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (idProdotto) REFERENCES Prodotti (idProdotto),
      FOREIGN KEY (CF) REFERENCES Anagrafica (CF)
    )
  `);

  console.log("Tabella Acquisti creata o già esistente.");
});



db.close();




// Funzione per sincronizzare i dati
async function sincronizzaXML() {
  const db = new sqlite3.Database('UpAndDown.db');
  const parser = new xml2js.Parser();

  fs.readFile(xmlFilePath, (err, data) => {
    if (err) throw err;

    parser.parseString(data, (err, result) => {
      if (err) throw err;

      const records = result.UpAndDown.Anagrafica || [];
      db.serialize(() => {
        records.forEach(record => {
          const {
            Nome, Cognome, Sesso, DataNascita, LuogoNascita, CF, Indirizzo,
            Comune, email, telefono, DataTesseramento, DataUltimoUpAndDown,
            DataUltimoUISP, IngressiBoulder, IngressiLudica, Foto
          } = record;

          db.run(`
            INSERT INTO Anagrafica (
              Nome, Cognome, Sesso, DataNascita, LuogoNascita, CF, Indirizzo,
              Comune, email, telefono, DataTesseramento, DataUltimoUpAndDown,
              DataUltimoUISP, IngressiBoulder, IngressiLudica, Foto
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(CF) DO UPDATE SET
              Nome = excluded.Nome,
              Cognome = excluded.Cognome,
              Sesso = excluded.Sesso,
              DataNascita = excluded.DataNascita,
              LuogoNascita = excluded.LuogoNascita,
              Indirizzo = excluded.Indirizzo,
              Comune = excluded.Comune,
              email = excluded.email,
              telefono = excluded.telefono,
              DataTesseramento = excluded.DataTesseramento,
              DataUltimoUpAndDown = excluded.DataUltimoUpAndDown,
              DataUltimoUISP = excluded.DataUltimoUISP,
              IngressiBoulder = excluded.IngressiBoulder,
              IngressiLudica = excluded.IngressiLudica,
              Foto = excluded.Foto
          `, [
            Nome[0], Cognome[0], Sesso[0], DataNascita[0], LuogoNascita[0], CF[0],
            Indirizzo[0], Comune[0], email[0], telefono[0], DataTesseramento[0],
            DataUltimoUpAndDown[0], DataUltimoUISP[0],
            parseInt(IngressiBoulder[0] || 0), parseInt(IngressiLudica[0] || 0),
            Foto ? Buffer.from(Foto[0], 'base64') : null // Converti foto in buffer binario
          ]);
        });
      });

      console.log("Sincronizzazione completata.");
      db.close();
    });
  });
}


// Funzione per formattare la data in formato DD/MM/YYYY
function formatDate(dateString) {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Funzione per determinare il colore della data
function getDateColor(dateString) {
  const date = new Date(dateString);
  const unAnnoFa = new Date();
  unAnnoFa.setFullYear(unAnnoFa.getFullYear() - 1);
  return date > unAnnoFa ? 'green' : 'red';
}

// Endpoint per avviare la sincronizzazione
app.get('/sync', (req, res) => {
  sincronizzaXML();
  res.send("Sincronizzazione avviata.");
});


// Funzione per determinare il colore della data di nascita
function getAgeColor(birthDateString) {
  const today = new Date();
  const birthDate = new Date(birthDateString);
  const age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  const dayDiff = today.getDate() - birthDate.getDate();

  // Calcolo preciso dell'età
  const exactAge = age - (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? 1 : 0);

  if (exactAge < 14) return 'red';
  if (exactAge >= 14 && exactAge < 18) return 'orange';
  return 'green';
}


// Funzione per formattare la data in dd/mm/yyyy
function formatDate(dateString) {
  if (!dateString) return "N/D";
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// // Endpoint per recuperare e modificare i dati
// app.get('/record/:cf', (req, res) => {
//   const codiceFiscale = req.params.cf;
//   const db = new sqlite3.Database('UpAndDown.db');

//   db.get('SELECT * FROM Anagrafica WHERE CF = ?', [codiceFiscale], (err, row) => {
//     if (err) {
//       res.status(500).send("Errore nel recupero del record.");
//       return;
//     }
//     if (!row) {
//       res.status(404).send("Record non trovato.");
//       return;
//     }

//     // Funzione per formattare i dati in formato leggibile
//     const formatField = (field) => (field ? field : "N/D");

//     // Funzione per determinare il colore della data
//     const getDateColor = (dateString) => {
//       const date = new Date(dateString);
//       const unAnnoFa = new Date();
//       unAnnoFa.setFullYear(unAnnoFa.getFullYear() - 1);
//       return date > unAnnoFa ? 'green' : 'red';
//     };

//     // Converti la foto in base64 per visualizzarla
//     const fotoSrc = row.Foto ? `data:image/jpeg;base64,${row.Foto.toString('base64')}` : '';

//     res.send(`
//       <html>
//         <head>
//           <title>Dettagli Tesseramento</title>
//           <style>
//             body { font-family: Arial, sans-serif; margin: 20px; }
//             h1 { color: #333; }
//             p, .field-row { font-size: 18px; margin: 10px 0; display: flex; align-items: center; justify-content: space-between; }
//             .field-label { font-weight: bold; width: 300px; }
//             .field-value { flex-grow: 1; }
//             .field-photo { display: flex; justify-content: center; margin: 20px 0; }
//             img { max-width: 200px; border-radius: 5px; border: 1px solid #ccc; }
//             .update-form { display: inline-block; margin-left: 20px; }
//             .date-value { font-weight: bold; }
//           </style>
//         </head>
//         <body>
//           <h1>Dettagli Tesseramento</h1>

//           <div class="field-photo">
//             ${fotoSrc ? `<img src="${fotoSrc}" alt="Foto utente">` : '<p>Foto non disponibile</p>'}
//           </div>

//           <div class="field-row">
//             <span class="field-label">Nome:</span>
//             <span class="field-value">${formatField(row.Nome)}</span>
//           </div>
//           <div class="field-row">
//             <span class="field-label">Cognome:</span>
//             <span class="field-value">${formatField(row.Cognome)}</span>
//           </div>
//           <div class="field-row">
//             <span class="field-label">Sesso:</span>
//             <span class="field-value">${formatField(row.Sesso)}</span>
//           </div>
//           <div class="field-row">
//                     <span class="field-label">Data di Nascita:</span>
//                     <span class="field-value date-value" style="color: ${getAgeColor(row.DataNascita)};">
//                         ${formatDate(row.DataNascita || 'N/D')}
//                     </span>
//           </div>
//           <div class="field-row">
//             <span class="field-label">Luogo di Nascita:</span>
//             <span class="field-value">${formatField(row.LuogoNascita)}</span>
//           </div>
//           <div class="field-row">
//             <span class="field-label">Codice Fiscale:</span>
//             <span class="field-value">${formatField(row.CF)}</span>
//           </div>
//           <div class="field-row">
//             <span class="field-label">Indirizzo:</span>
//             <span class="field-value">${formatField(row.Indirizzo)}</span>
//           </div>
//           <div class="field-row">
//             <span class="field-label">Comune:</span>
//             <span class="field-value">${formatField(row.Comune)}</span>
//           </div>
//           <div class="field-row">
//             <span class="field-label">Email:</span>
//             <span class="field-value">${formatField(row.email)}</span>
//           </div>
//           <div class="field-row">
//             <span class="field-label">Telefono:</span>
//             <span class="field-value">${formatField(row.telefono)}</span>
//           </div>
//           <div class="field-row">
//             <span class="field-label">Data Tesseramento:</span>
//             <span class="field-value">${formatField(row.DataTesseramento)}</span>
//           </div>

//           <div class="field-row">
//             <span class="field-label">Data Ultimo Up and Down:</span>
//             <span class="field-value date-value" style="color: ${getDateColor(row.DataUltimoUpAndDown)};">${formatDate(row.DataUltimoUpAndDown)}</span>
//             <form class="update-form" action="/update" method="post">
//               <input type="hidden" name="CF" value="${row.CF}">
//               <input type="hidden" name="field" value="DataUltimoUpAndDown">
//               <input type="date" name="value" required>
//               <input type="password" name="password" placeholder="Password" required>
//               <button type="submit">Aggiorna</button>
//             </form>
//           </div>

//           <div class="field-row">
//             <span class="field-label">Data Ultimo UISP:</span>
//             <span class="field-value date-value" style="color: ${getDateColor(row.DataUltimoUISP)};">${formatDate(row.DataUltimoUISP)}</span>
//             <form class="update-form" action="/update" method="post">
//               <input type="hidden" name="CF" value="${row.CF}">
//               <input type="hidden" name="field" value="DataUltimoUISP">
//               <input type="date" name="value" required>
//               <input type="password" name="password" placeholder="Password" required>
//               <button type="submit">Aggiorna</button>
//             </form>
//           </div>

//           <div class="field-row">
//             <span class="field-label">Ingressi Boulder:</span>
//             <span class="field-value">${formatField(row.IngressiBoulder)}</span>
//             <form class="update-form" action="/update-decrement" method="post">
//               <input type="hidden" name="CF" value="${row.CF}">
//               <input type="hidden" name="field" value="IngressiBoulder">
//               <input type="password" name="password" placeholder="Password" required>
//               <button type="submit">Diminuisci di 1</button>
//             </form>
//           </div>

//           <div class="field-row">
//             <span class="field-label">Ingressi Ludica:</span>
//             <span class="field-value">${formatField(row.IngressiLudica)}</span>
//             <form class="update-form" action="/update-decrement" method="post">
//               <input type="hidden" name="CF" value="${row.CF}">
//               <input type="hidden" name="field" value="IngressiLudica">
//               <input type="password" name="password" placeholder="Password" required>
//               <button type="submit">Diminuisci di 1</button>
//             </form>
//           </div>

//           <div class="field-row">
//             <span class="field-label">Last Modified:</span>
//             <span class="field-value">${formatField(row.LastModified)}</span>
//           </div>


//           <div style="text-align: center; margin-top: 20px;">
//     <form action="/shop" method="get">
//         <input type="hidden" name="CF" value="${row.CF}">
//         <button type="submit" style="font-size: 20px; padding: 10px 20px;">Acquisti</button>
//     </form>
// </div>

//         </body>
//       </html>

//     `);
//   });
//   db.close();
// });


// Endpoint per recuperare e modificare i dati
app.get('/record/:encryptedCF', (req, res) => {

  console.log("Richiesta ricevuta:", req.params.encryptedCF);
  const encryptedCF = decodeURIComponent(req.params.encryptedCF);
  console.log("Codice Fiscale decriptato:",encryptedCF)

    // Decifra il codice fiscale
    let CF;
    try {
        CF = decryptCF(encryptedCF);        
    } catch (err) {
        return res.status(400).send("Codice fiscale non valido.");
    }

 const db = new sqlite3.Database('UpAndDown.db');
  
  db.get('SELECT * FROM Anagrafica WHERE CF = ?', [CF], (err, row) => {
    if (err) {
      res.status(500).send("Errore nel recupero del record.");
      return;
    }
    if (!row) {
      res.status(404).send("Record non trovato.");
      return;
    }

    // Funzione per formattare i dati in formato leggibile
    const formatField = (field) => (field ? field : "N/D");

    // Funzione per determinare il colore della data
    const getDateColor = (dateString) => {
      const date = new Date(dateString);
      const unAnnoFa = new Date();
      unAnnoFa.setFullYear(unAnnoFa.getFullYear() - 1);
      return date > unAnnoFa ? 'green' : 'red';
    };

    // Converti la foto in base64 per visualizzarla
    const fotoSrc = row.Foto ? `data:image/jpeg;base64,${row.Foto.toString('base64')}` : '';

    res.send(`
      <html>
        <head>
          <title>Dettagli Tesseramento</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #333; }
            p, .field-row { font-size: 18px; margin: 10px 0; display: flex; align-items: center; justify-content: space-between; }
            .field-label { font-weight: bold; width: 300px; }
            .field-value { flex-grow: 1; }
            .field-photo { display: flex; justify-content: center; margin: 20px 0; }
            img { max-width: 200px; border-radius: 5px; border: 1px solid #ccc; }
            .update-form { display: inline-block; margin-left: 20px; }
            .date-value { font-weight: bold; }
          </style>
        </head>
        <body>
          <h1>Dettagli Tesseramento</h1>

          <div class="field-photo">
            ${fotoSrc ? `<img src="${fotoSrc}" alt="Foto utente">` : '<p>Foto non disponibile</p>'}
          </div>

          <div class="field-row">
            <span class="field-label">Nome:</span>
            <span class="field-value">${formatField(row.Nome)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Cognome:</span>
            <span class="field-value">${formatField(row.Cognome)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Sesso:</span>
            <span class="field-value">${formatField(row.Sesso)}</span>
          </div>
          <div class="field-row">
                    <span class="field-label">Data di Nascita:</span>
                    <span class="field-value date-value" style="color: ${getAgeColor(row.DataNascita)};">
                        ${formatDate(row.DataNascita || 'N/D')}
                    </span>
          </div>
          <div class="field-row">
            <span class="field-label">Luogo di Nascita:</span>
            <span class="field-value">${formatField(row.LuogoNascita)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Codice Fiscale:</span>
            <span class="field-value">${formatField(row.CF)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Indirizzo:</span>
            <span class="field-value">${formatField(row.Indirizzo)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Comune:</span>
            <span class="field-value">${formatField(row.Comune)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Email:</span>
            <span class="field-value">${formatField(row.email)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Telefono:</span>
            <span class="field-value">${formatField(row.telefono)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Data Tesseramento:</span>
            <span class="field-value">${formatField(row.DataTesseramento)}</span>
          </div>

          <div class="field-row">
            <span class="field-label">Data Ultimo Up and Down:</span>
            <span class="field-value date-value" style="color: ${getDateColor(row.DataUltimoUpAndDown)};">${formatDate(row.DataUltimoUpAndDown)}</span>
            <form class="update-form" action="/update" method="post">
              <input type="hidden" name="CF" value="${row.CF}">
              <input type="hidden" name="field" value="DataUltimoUpAndDown">
              <input type="date" name="value" required>
              <input type="password" name="password" placeholder="Password" required>
              <button type="submit">Aggiorna</button>
            </form>
          </div>

          <div class="field-row">
            <span class="field-label">Data Ultimo UISP:</span>
            <span class="field-value date-value" style="color: ${getDateColor(row.DataUltimoUISP)};">${formatDate(row.DataUltimoUISP)}</span>
            <form class="update-form" action="/update" method="post">
              <input type="hidden" name="CF" value="${row.CF}">
              <input type="hidden" name="field" value="DataUltimoUISP">
              <input type="date" name="value" required>
              <input type="password" name="password" placeholder="Password" required>
              <button type="submit">Aggiorna</button>
            </form>
          </div>

          <div class="field-row">
            <span class="field-label">Ingressi Boulder:</span>
            <span class="field-value">${formatField(row.IngressiBoulder)}</span>
            <form class="update-form" action="/update-decrement" method="post">
              <input type="hidden" name="CF" value="${row.CF}">
              <input type="hidden" name="field" value="IngressiBoulder">
              <input type="password" name="password" placeholder="Password" required>
              <button type="submit">Diminuisci di 1</button>
            </form>
          </div>

          <div class="field-row">
            <span class="field-label">Ingressi Ludica:</span>
            <span class="field-value">${formatField(row.IngressiLudica)}</span>
            <form class="update-form" action="/update-decrement" method="post">
              <input type="hidden" name="CF" value="${row.CF}">
              <input type="hidden" name="field" value="IngressiLudica">
              <input type="password" name="password" placeholder="Password" required>
              <button type="submit">Diminuisci di 1</button>
            </form>
          </div>

          <div class="field-row">
            <span class="field-label">Last Modified:</span>
            <span class="field-value">${formatField(row.LastModified)}</span>
          </div>


          <div style="text-align: center; margin-top: 20px;">
    <form action="/shop" method="get">
        <input type="hidden" name="CF" value="${row.CF}">
        <button type="submit" style="font-size: 20px; padding: 10px 20px;">Acquisti</button>
    </form>
</div>

        </body>
      </html>

    `);
  });
  db.close();
});


app.post('/update', (req, res) => {
  const { CF, field, value, password } = req.body;
  console.log("Dati ricevuti dall'HTML:", { CF, field, value, password });
  // Controllo password
  if (password !== decryptedPassword) {
      res.status(401).send(`
          <html>
              <head><title>Password Errata</title></head>
              <body>
                  <h1>Password errata</h1>
                  <button onclick="window.history.back()">Torna Indietro</button>
              </body>
          </html>
      `);
      return;
  }

  // Controlla che i parametri richiesti siano presenti
  if (!CF || !field || !value ) {
      res.status(400).send("Parametri mancanti o non validi.");
      return;
  }

  const db = new sqlite3.Database('UpAndDown.db');

  let updateQuery;
  let params = [value, new Date().toISOString(), CF];

  if (field === "Foto") {
      // Aggiorna il campo Foto come BLOB
      updateQuery = `
          UPDATE Anagrafica
          SET ${field} = ?, LastModified = ?
          WHERE CF = ?;
      `;
      params[0] = Buffer.from(value, 'base64'); // Conversione Base64 a BLOB
  } else {
      // Aggiorna qualsiasi altro campo
      updateQuery = `
          UPDATE Anagrafica
          SET ${field} = ?, LastModified = ?
          WHERE CF = ?;
      `;
  }

  db.run(updateQuery, params, function (err) {
      if (err) {
          console.error("Errore nell'aggiornamento:", err.message);
          res.status(500).send("Errore nell'aggiornamento.");
          return;
      }

      if (this.changes === 0) {
          res.status(404).send("Record non trovato o nessun cambiamento effettuato.");
          return;
      }

      res.send(`
        <html>
            <head><title>Aggiornamento Completato</title></head>
            <body>
                <h1>Aggiornamento completato</h1>
                <button onclick="window.location.href = '/record/${encryptCF(CF)}';">Torna alla Pagina Utente</button>
            </body>
        </html>
    `);
  });

  db.close();
});



// Endpoint per aggiornare i valori
app.post('/update-decrement', (req, res) => {
  const { CF, field, password } = req.body;

  // Controlla la password
  if (password !== decryptedPassword) {
    res.send(`
      <html>
        <head><title>Password Errata</title></head>
        <body>
          <h1>Password errata</h1>
          <button onclick="window.history.back()">Torna Indietro</button>
        </body>
      </html>
    `);
    return;
  }

  // Verifica se il campo è valido
  if (!['IngressiBoulder', 'IngressiLudica'].includes(field)) {
    res.status(400).send("Campo non valido per decremento.");
    return;
  }

  const db = new sqlite3.Database('UpAndDown.db');

  // Query per decrementare il campo specifico e aggiornare LastModified
  const updateQuery = `
    UPDATE Anagrafica
    SET ${field} = CASE
                      WHEN ${field} > 0 THEN ${field} - 1
                      ELSE 0
                   END,
        LastModified = datetime('now')
    WHERE CF = ?`;

  db.run(updateQuery, [CF], function (err) {
    if (err) {
      res.status(500).send("Errore nell'aggiornamento.");
      return;
    }

    // Se non sono state aggiornate righe, significa che CF non è stato trovato
    if (this.changes === 0) {
      res.status(404).send("Record non trovato.");
      return;
    }

    // Risposta HTML per reindirizzare alla pagina del record
    res.send(`
      <html>
        <head><title>Aggiornamento Completato</title></head>
        <body>
          <h1>Aggiornamento completato</h1>
          <button onclick="window.location.href = '/record/${encryptCF(CF)}?updated=true';">Torna Indietro e Ricarica</button>
        </body>
      </html>
    `);
  });

  db.close();
});


// Pagina Shop

app.get('/shop', (req, res) => {
  const CF = req.query.CF;

  if (!CF) {
      res.status(400).send("Codice Fiscale non fornito.");
      return;
  }

  const db = new sqlite3.Database('UpAndDown.db');

  db.all("SELECT * FROM Prodotti", [], (err, rows) => {
      if (err) {
          console.error("Errore nel recupero dei prodotti:", err.message);
          res.status(500).send("Errore nel recupero dei prodotti.");
          return;
      }

      const prodottiHTML = rows.map(row => `
          <tr>
              <td>${row.Prodotto}</td>
              <td>${row.PrezzoUnitario.toFixed(2)} €</td>
              <td>
                  <input type="number" name="quantità-${row.idProdotto}" min="0" placeholder="Quantità">
              </td>
          </tr>
      `).join("");

      res.send(`
          <html>
          <head>
              <title>Acquisti</title>
              <style>
                  table {
                      width: 80%;
                      margin: 20px auto;
                      border-collapse: collapse;
                  }
                  th, td {
                      border: 1px solid #ddd;
                      padding: 8px;
                      text-align: center;
                  }
                  th {
                      background-color: #f4f4f4;
                      font-weight: bold;
                  }
                  button {
                      margin-top: 20px;
                      padding: 10px 20px;
                      font-size: 16px;
                      cursor: pointer;
                  }
              </style>
          </head>
          <body>
              <h1 style="text-align: center;">Acquisti per CF: ${CF}</h1>
              <form action="/purchase" method="post" style="text-align: center;">
                  <input type="hidden" name="CF" value="${CF}">
                  <table>
                      <thead>
                          <tr>
                              <th>Prodotto</th>
                              <th>Prezzo Unitario</th>
                              <th>Quantità</th>
                          </tr>
                      </thead>
                      <tbody>
                          ${prodottiHTML}
                      </tbody>
                  </table>
                  <input type="password" name="password" placeholder="Password" required>
                  <button type="submit">Acquista</button>
              </form>
          </body>
          </html>
      `);

      db.close();
  });
});


// Endpoint per gestire gli acquisti
app.post('/purchase', (req, res) => {
  const { CF, password, ...quantitaFields } = req.body;

  //console.log("Dati ricevuti:", req.body); // Log per debug

  if (!CF || !password) {
      return res.status(400).send("Parametri mancanti o non validi.");
  }

  if (password !== decryptedPassword) {
      return res.status(401).send("Password errata.");
  }

  const acquisti = Object.keys(quantitaFields)
      .filter(key => key.startsWith('quantità-'))
      .map(key => {
          const idProdotto = key.split('-')[1];
          const quantita = parseInt(quantitaFields[key], 10);
          return { idProdotto, quantita };
      })
      .filter(acquisto => acquisto.quantita > 0);

  if (acquisti.length === 0) {
      return res.status(400).send("Nessun prodotto selezionato.");
  }

  const db = new sqlite3.Database('UpAndDown.db');
  let totale = 0; // Spostato fuori dal blocco per essere accessibile in seguito
  let operazioniDaCompletare = acquisti.length;

  acquisti.forEach(acquisto => {
      const { idProdotto, quantita } = acquisto;

      db.get("SELECT Prodotto, PrezzoUnitario FROM Prodotti WHERE idProdotto = ?", [idProdotto], (err, row) => {
          if (err) {
              console.error("Errore nel recupero del prodotto:", err.message);
              operazioniDaCompletare--;
              return;
          }

          if (!row) {
              console.error(`Prodotto con idProdotto=${idProdotto} non trovato.`);
              operazioniDaCompletare--;
              return;
          }

          const { Prodotto, PrezzoUnitario } = row;
          const subtotale = PrezzoUnitario * quantita;
          totale += subtotale;

          db.run(`
              INSERT INTO Acquisti (CF, idProdotto, Prodotto, PrezzoUnitario, Quantità, LastModified)
              VALUES (?, ?, ?, ?, ?, datetime('now'))
          `, [CF, idProdotto, Prodotto, PrezzoUnitario, quantita], (err) => {
              if (err) {
                  console.error("Errore durante l'inserimento dell'acquisto:", err.message);
              }
              operazioniDaCompletare--;

              if (operazioniDaCompletare === 0) {
                  db.close((err) => {
                      if (err) {
                          console.error("Errore durante la chiusura del database:", err.message);
                          return res.status(500).send("Errore durante l'elaborazione dell'acquisto.");
                      }

                      res.send(`
                          <html>
                              <head><title>Acquisto Completato</title></head>
                              <body>
                                  <h1>Acquisto Completato</h1>
                                  <p>Totale: €${totale.toFixed(2)}</p>
                                  <button onclick="window.location.href = '/record/${encryptCF(CF)}';">Torna alla Pagina Utente</button>
                              </body>
                          </html>
                      `);
                  });
              }
          });
      });
  });
});



app.post('/update-with-timestamp', (req, res) => {
  const {
    CF, Nome, Cognome, Sesso, DataNascita, LuogoNascita, Indirizzo, Comune,
    email, telefono, DataTesseramento, DataUltimoUpAndDown, DataUltimoUISP,
    IngressiBoulder, IngressiLudica, Foto, LastModified
  } = req.body;

  console.log("Dati ricevuti:", req.body); // Log per debug

  const db = new sqlite3.Database('UpAndDown.db');

  // Verifica del record esistente
  db.get("SELECT LastModified FROM Anagrafica WHERE CF = ?", [CF], (err, row) => {
    if (err) {
      console.error("Errore nel controllo del timestamp:", err.message);
      res.status(500).send("Errore nel controllo del timestamp.");
      return;
    }

    const clientTimestamp = new Date(LastModified).getTime();
    if (isNaN(clientTimestamp)) {
      console.error("Timestamp client non valido:", LastModified);
      res.status(400).send("Timestamp client non valido.");
      return;
    }

    if (!row) {
      // Inserisce il nuovo record se non esiste
      db.run(
        `INSERT INTO Anagrafica (
          Nome, Cognome, Sesso, DataNascita, LuogoNascita, Indirizzo, Comune,
          email, telefono, DataTesseramento, DataUltimoUpAndDown, DataUltimoUISP,
          IngressiBoulder, IngressiLudica, Foto, LastModified, CF
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
        [
          Nome, Cognome, Sesso, DataNascita, LuogoNascita, Indirizzo,
          Comune, email, telefono, DataTesseramento, DataUltimoUpAndDown,
          DataUltimoUISP, parseInt(IngressiBoulder || 0), parseInt(IngressiLudica || 0),
          Foto ? Buffer.from(Foto, 'base64') : null, CF
        ],
        function (err) {
          if (err) {
            console.error("Errore nell'inserimento:", err.message);
            res.status(500).send("Errore nell'inserimento del nuovo record.");
            return;
          }
          res.send("Nuovo record inserito con successo.");
        }
      );
      return;
    }

    const serverTimestamp = new Date(row.LastModified).getTime();
    console.log(`Timestamp DB: ${new Date(serverTimestamp)}, Timestamp Client: ${new Date(clientTimestamp)}`);

    if (serverTimestamp > clientTimestamp) {
      console.log(`Conflitto: Timestamp DB: ${new Date(serverTimestamp)}, Timestamp Client: ${new Date(clientTimestamp)}`);
      res.status(409).send("Conflitto di aggiornamento: il record è stato modificato da un altro client.");
      return;
    }

    // Aggiorna tutti i campi e il timestamp
    db.run(
      `UPDATE Anagrafica SET
        Nome = ?, Cognome = ?, Sesso = ?, DataNascita = ?, LuogoNascita = ?,
        Indirizzo = ?, Comune = ?, email = ?, telefono = ?, DataTesseramento = ?,
        DataUltimoUpAndDown = ?, DataUltimoUISP = ?, IngressiBoulder = ?,
        IngressiLudica = ?, Foto = ?, LastModified = datetime('now')
      WHERE CF = ?`,
      [
        Nome, Cognome, Sesso, DataNascita, LuogoNascita, Indirizzo,
        Comune, email, telefono, DataTesseramento, DataUltimoUpAndDown,
        DataUltimoUISP, parseInt(IngressiBoulder || 0),
        parseInt(IngressiLudica || 0), Foto ? Buffer.from(Foto, 'base64') : null, CF
      ],
      function (err) {
        if (err) {
          console.error("Errore nell'aggiornamento:", err.message);
          res.status(500).send("Errore nell'aggiornamento.");
          return;
        }
        res.send("Aggiornamento completato.");
      }
    );
  });

  db.close();
});


// End point che scarica in un JSON con un array di tutti i codici fiscali e delle relative versioni del record
app.get('/get-versions', (req, res) => {
  const db = new sqlite3.Database('UpAndDown.db');

  db.all('SELECT CF, LastModified FROM Anagrafica', (err, rows) => {
    if (err) {
      res.status(500).send("Errore nel recupero delle versioni.");
      return;
    }
    res.json(rows); // Restituisce un array di oggetti con CF e LastModified
  });

  db.close();
});

app.get('/download-xml', (req, res) => {
  const db = new sqlite3.Database('UpAndDown.db');

  db.all("SELECT * FROM Anagrafica", (err, rows) => {
    if (err) {
      console.error("Errore nella lettura del database:", err.message);
      res.status(500).send("Errore nella lettura del database.");
      return;
    }

    // Trasformiamo i record per:
    // - Convertire `Foto` da BLOB a base64.
    // - Escapare i caratteri speciali nei valori.
    const sanitizeForXML = value => {
      if (typeof value === 'string') {
        return value.replace(/[<>&'"]/g, match => {
          switch (match) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case "'": return '&apos;';
            case '"': return '&quot;';
          }
        });
      }
      return value;
    };

    const transformedRows = rows.map(row => {
      const sanitizedRow = {};
      for (const key in row) {
        sanitizedRow[sanitizeForXML(key)] = sanitizeForXML(row[key]);
      }
      if (row.Foto) {
        sanitizedRow.Foto = row.Foto.toString('base64'); // Converti `Foto` in base64
      }
      return sanitizedRow;
    });

    try {
      const builder = new xml2js.Builder();
      const xml = builder.buildObject({ UpAndDown: { Anagrafica: transformedRows } });

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', 'attachment; filename="database.xml"');
      res.send(xml);
    } catch (buildErr) {
      console.error("Errore nella costruzione dell'XML:", buildErr.message);
      res.status(500).send("Errore nella costruzione del file XML.");
    }
  });

  db.close();
});


app.post('/update-records', (req, res) => {
  const records = req.body;
  console.log("Dati ricevuti:", req.body); // Log per debug
  if (!Array.isArray(records)) {
    return res.status(400).send("Dati non validi o mancanti.");
  }

  const db = new sqlite3.Database('UpAndDown.db');

  db.serialize(() => {
    records.forEach(record => {
      const {
        CF, Nome, Cognome, Sesso, DataNascita, LuogoNascita, Indirizzo,
        Comune, email, telefono, DataTesseramento, DataUltimoUpAndDown,
        DataUltimoUISP, IngressiBoulder, IngressiLudica, Foto, LastModified
      } = record;

      db.run(`
        INSERT INTO Anagrafica (
          Nome, Cognome, Sesso, DataNascita, LuogoNascita, Indirizzo, Comune,
          email, telefono, DataTesseramento, DataUltimoUpAndDown, DataUltimoUISP,
          IngressiBoulder, IngressiLudica, Foto, LastModified, CF
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(CF) DO UPDATE SET
          Nome = excluded.Nome,
          Cognome = excluded.Cognome,
          Sesso = excluded.Sesso,
          DataNascita = excluded.DataNascita,
          LuogoNascita = excluded.LuogoNascita,
          Indirizzo = excluded.Indirizzo,
          Comune = excluded.Comune,
          email = excluded.email,
          telefono = excluded.telefono,
          DataTesseramento = excluded.DataTesseramento,
          DataUltimoUpAndDown = excluded.DataUltimoUpAndDown,
          DataUltimoUISP = excluded.DataUltimoUISP,
          IngressiBoulder = excluded.IngressiBoulder,
          IngressiLudica = excluded.IngressiLudica,
          Foto = excluded.Foto,
          LastModified = excluded.LastModified
      `, [
        Nome, Cognome, Sesso, DataNascita, LuogoNascita, Indirizzo, Comune,
        email, telefono, DataTesseramento, DataUltimoUpAndDown,
        DataUltimoUISP, IngressiBoulder, IngressiLudica,
        Foto ? Buffer.from(Foto, 'base64') : null, LastModified, CF
      ]);
    });
  });

  db.close();
  res.send("Records aggiornati con successo.");
});


function normalize(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return value;
}


app.get('/get-timestamps', (req, res) => {
  const db = new sqlite3.Database('UpAndDown.db');

  db.all('SELECT CF, LastModified FROM Anagrafica', (err, rows) => {
    if (err) {
      console.error("Errore nel recupero dei timestamp:", err.message);
      res.status(500).send("Errore nel recupero dei timestamp.");
      return;
    }

    res.json(rows); // Restituisce un array di oggetti con CF e LastModified
    db.close();
  });
});


// Endpoint con timestamp 
app.post('/update-product-with-timestamp', (req, res) => {
  const { idProdotto, Prodotto, PrezzoUnitario, LastModified } = req.body;

  console.log("Dati ricevuti:", req.body); // Log per debug

  const db = new sqlite3.Database('UpAndDown.db');

  // Verifica del record esistente
  db.get("SELECT LastModified FROM Prodotti WHERE idProdotto = ?", [idProdotto], (err, row) => {
      if (err) {
          console.error("Errore nel controllo del timestamp:", err.message);
          res.status(500).send("Errore nel controllo del timestamp.");
          return;
      }

      const clientTimestamp = new Date(LastModified).getTime();
      if (isNaN(clientTimestamp)) {
          console.error("Timestamp client non valido:", LastModified);
          res.status(400).send("Timestamp client non valido.");
          return;
      }

      if (!row) {
          // Inserisce il nuovo record se non esiste
          db.run(
              `INSERT INTO Prodotti (
                  idProdotto, Prodotto, PrezzoUnitario, LastModified
              ) VALUES (?, ?, ?, datetime('now'))`,
              [
                  idProdotto,
                  normalize(Prodotto),
                  parseFloat(PrezzoUnitario.toString().replace(',', '.') || 0)
              ],
              function (err) {
                  if (err) {
                      console.error("Errore nell'inserimento:", err.message);
                      res.status(500).send("Errore nell'inserimento del nuovo record.");
                      return;
                  }
                  res.send("Nuovo prodotto inserito con successo.");
              }
          );
          return;
      }

      const serverTimestamp = new Date(row.LastModified).getTime();
      console.log(`Timestamp DB: ${new Date(serverTimestamp)}, Timestamp Client: ${new Date(clientTimestamp)}`);

      if (serverTimestamp > clientTimestamp) {
          console.log(`Conflitto: Timestamp DB: ${new Date(serverTimestamp)}, Timestamp Client: ${new Date(clientTimestamp)}`);
          res.status(409).send("Conflitto di aggiornamento: il prodotto è stato modificato da un altro client.");
          return;
      }

      // Aggiorna tutti i campi e il timestamp
      db.run(
          `UPDATE Prodotti SET
              Prodotto = ?, PrezzoUnitario = ?, LastModified = datetime('now')
          WHERE idProdotto = ?`,
          [
              normalize(Prodotto),
              parseFloat(PrezzoUnitario.toString().replace(',', '.') || 0),
              idProdotto
          ],
          function (err) {
              if (err) {
                  console.error("Errore nell'aggiornamento:", err.message);
                  res.status(500).send("Errore nell'aggiornamento.");
                  return;
              }
              res.send("Aggiornamento prodotto completato.");
          }
      );
  });

  db.close();
});


// Funzione di normalizzazione dei dati
function normalize(value) {
  return value === undefined || value === null || value === "" ? null : value;
}


app.get('/get-records', (req, res) => {
  const cfs = req.query.CFs; // Ottieni i CF dalla query string
  if (!cfs) {
      console.error("Parametri CFs mancanti");
      res.status(400).send("Parametri CFs mancanti");
      return;
  }

  // Dividi i CF in un array (separati da virgola)
  const cfArray = cfs.split(',');
  console.log("CF ricevuti:", cfArray);

  const placeholders = cfArray.map(() => '?').join(',');
  const query = `
      SELECT *
      FROM Anagrafica
      WHERE CF IN (${placeholders})
  `;

  const db = new sqlite3.Database('UpAndDown.db', (err) => {
      if (err) {
          console.error("Errore nell'apertura del database:", err.message);
          res.status(500).send("Errore nell'apertura del database");
          return;
      }

      console.log("Connessione al database aperta.");

      db.all(query, cfArray, (err, rows) => {
          if (err) {
              console.error("Errore nel recupero dei record:", err.message);
              res.status(500).send("Errore durante il recupero dei record");
              return;
          }

          console.log("Record trovati:", rows);
          res.json(rows);

          // Chiudi la connessione al database dopo aver completato la query
          db.close((err) => {
              if (err) {
                  console.error("Errore durante la chiusura del database:", err.message);
              }
              console.log("Connessione al database chiusa.");
          });
      });
  });
});

app.get('/export-timestamps', (req, res) => {
    console.log(`[LOG] Richiesta ricevuta: ${req.method} ${req.url}`);
    const db = new sqlite3.Database('UpAndDown.db');
    const query = "SELECT CF, LastModified FROM Anagrafica";

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error("Errore nell'esportazione dei timestamp:", err.message);
            res.status(500).send("Errore nell'esportazione dei timestamp.");
            return;
        }

        // Crea l'XML
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Records>\n';
        rows.forEach(row => {
            xml += `  <Record>\n    <CF>${row.CF}</CF>\n    <LastModified>${row.LastModified}</LastModified>\n  </Record>\n`;
        });
        xml += '</Records>';

        // Salva il file XML
        const filePath = './timestamps.xml';
        fs.writeFileSync(filePath, xml);

        // Invia il file al client
        res.download(filePath, 'timestamps.xml', (err) => {
            if (err) {
                console.error("Errore nell'invio del file:", err.message);
            }
            db.close();
        });
    });
});

app.post('/export-records', (req, res) => {
  const CFsString = req.body.CFs;

  if (!CFsString || typeof CFsString !== "string") {
      console.error("CFs non è una stringa valida. Valore ricevuto:", CFsString);
      return res.status(400).send("Formato dei CFs non valido.");
  }

  const CFs = CFsString.split(",").map(cf => cf.trim());
  console.log("CFs trasformati in array:", CFs);

  const db = new sqlite3.Database('UpAndDown.db');

  db.all(
      `SELECT * FROM Anagrafica WHERE CF IN (${CFs.map(() => '?').join(',')})`,
      CFs,
      (err, rows) => {
          if (err) {
              console.error("Errore nel recupero dei record:", err.message);
              return res.status(500).send("Errore nel recupero dei record.");
          }

          if (rows.length === 0) {
              console.log("Nessun record trovato per i CFs forniti.");
              return res.status(404).send("Nessun record trovato.");
          }

          // Converti i record in XML con il nome della tabella "Anagrafica"
          const sanitizeForXML = value => {
              if (typeof value === 'string') {
                  return value.replace(/[<>&'"]/g, match => {
                      switch (match) {
                          case '<': return '&lt;';
                          case '>': return '&gt;';
                          case '&': return '&amp;';
                          case "'": return '&apos;';
                          case '"': return '&quot;';
                      }
                  });
              }
              return value;
          };

          const transformedRows = rows.map(row => {
              const sanitizedRow = {};
              for (const key in row) {
                  sanitizedRow[sanitizeForXML(key)] = sanitizeForXML(row[key]);
              }
              if (row.Foto) {
                  sanitizedRow.Foto = row.Foto.toString('base64'); // Converti `Foto` in base64
              }
              return sanitizedRow;
          });

          try {
              const builder = new xml2js.Builder({ rootName: 'Anagrafica' });
              const xml = builder.buildObject({ Record: transformedRows });

              res.setHeader('Content-Type', 'application/xml');
              res.setHeader('Content-Disposition', 'attachment; filename="anagrafica.xml"');
              res.send(xml);
          } catch (buildErr) {
              console.error("Errore nella costruzione dell'XML:", buildErr.message);
              res.status(500).send("Errore nella costruzione del file XML.");
          }
      }
  );

  db.close();
});


function sanitizeRecord(record) {
  const sanitizedRecord = {};
  for (const [key, value] of Object.entries(record)) {
      sanitizedRecord[key] = value !== null && value !== undefined ? value : ''; // Sostituisce null/undefined con stringa vuota
  }
  return sanitizedRecord;
}

const xmlbuilder = require('xmlbuilder');

function sanitizeXMLName(name) {
  // Sostituisce caratteri non validi con un underscore
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function generateXMLFromRecords(records) {
  const root = xmlbuilder.create('Anagrafica'); // Nodo radice

  records.forEach(record => {
      const recordNode = root.ele('Anagrafica'); // Nodo per ogni record

      for (const [key, value] of Object.entries(record)) {
          const sanitizedKey = sanitizeXMLName(key); // Sanitizza il nome del campo

          // Ignora i campi non necessari o problematici
          if (sanitizedKey === "Foto") continue;

          try {
              // Aggiungi ogni chiave-valore come elemento, gestendo eventuali valori null
              recordNode.ele(sanitizedKey, value !== null && value !== undefined ? value : '');
          } catch (err) {
              console.error(`Errore nell'aggiunta del campo ${sanitizedKey}: ${err.message}`);
          }
      }
  });

  return root.end({ pretty: true }); // Genera l'XML formattato
}




app.get('/get-updated-records', (req, res) => {
  const lastSync = req.query.lastSync; // Riceve il timestamp dell'ultima sincronizzazione

  if (!lastSync) {
    res.status(400).send("Timestamp dell'ultima sincronizzazione non fornito.");
    return;
  }

  const db = new sqlite3.Database('UpAndDown.db');

  db.all(
    "SELECT * FROM Anagrafica WHERE LastModified > ?",
    [lastSync],
    (err, rows) => {
      if (err) {
        console.error("Errore nel recupero dei record aggiornati:", err.message);
        res.status(500).send("Errore nel recupero dei record aggiornati.");
        return;
      }

      // Trasforma i record per inviarli al client
      const records = rows.map(row => ({
        CF: row.CF,
        Nome: row.Nome,
        Cognome: row.Cognome,
        Sesso: row.Sesso,
        DataNascita: row.DataNascita,
        LuogoNascita: row.LuogoNascita,
        Indirizzo: row.Indirizzo,
        Comune: row.Comune,
        email: row.email,
        telefono: row.telefono,
        DataTesseramento: row.DataTesseramento,
        DataUltimoUpAndDown: row.DataUltimoUpAndDown,
        DataUltimoUISP: row.DataUltimoUISP,
        IngressiBoulder: row.IngressiBoulder,
        IngressiLudica: row.IngressiLudica,
        Foto: row.Foto ? row.Foto.toString('base64') : null, // Converti Foto in Base64
        LastModified: row.LastModified
      }));

      res.json(records); // Restituisce i record aggiornati come JSON
    }
  );

  db.close();
});



// app.listen(port, () => {
//   console.log(`Server in esecuzione su http://0.0.0.0:${port}`);
// });


//Questa versione restituisce una versione XML che quindi forse posso eliminare percHè la gestisco con un JSON
  app.get('/export-product-timestamps', (req, res) => {
    const db = new sqlite3.Database('UpAndDown.db');
  
    db.all("SELECT idProdotto, LastModified FROM Prodotti", (err, rows) => {
      if (err) {
        console.error("Errore nel recupero dei timestamp dei prodotti:", err.message);
        res.status(500).send("Errore nel recupero dei timestamp dei prodotti.");
        return;
      }
  
      // Crea l'XML dai dati recuperati
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Prodotti>\n';
      rows.forEach(row => {
        xml += `  <Prodotto>\n    <idProdotto>${row.idProdotto}</idProdotto>\n    <LastModified>${row.LastModified}</LastModified>\n  </Prodotto>\n`;
      });
      xml += '</Prodotti>';
  
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', 'attachment; filename="product_timestamps.xml"');
      res.send(xml);
    });
  
    db.close();
  });




// Endpoint per ottenere i timestamp dei prodotti


app.get('/get-product-timestamps', (req, res) => {
    const db = new sqlite3.Database('UpAndDown.db');
    const query = "SELECT idProdotto, LastModified FROM Prodotti";

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error("Errore nel recupero dei timestamp dei prodotti:", err.message);
            res.status(500).send("Errore nel recupero dei timestamp.");
            return;
        }
        res.json(rows);

        db.close((err) => {
            if (err) {
                console.error("Errore durante la chiusura del database:", err.message);
            }
        });
    });
});

// Endpoint per sincronizzare i prodotti
app.post('/sync-products', (req, res) => {
    const products = req.body;
    console.log("Dati ricevuti:", req.body); // Log per debug
    if (!Array.isArray(products)) {
        return res.status(400).send("Dati non validi o mancanti.");
    }

    const db = new sqlite3.Database('UpAndDown.db');

    db.serialize(() => {
        products.forEach(product => {
            const { idProdotto, Prodotto, PrezzoUnitario, LastModified } = product;

            db.run(`
                INSERT INTO Prodotti (idProdotto, Prodotto, PrezzoUnitario, LastModified)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(idProdotto) DO UPDATE SET
                    Prodotto = excluded.Prodotto,
                    PrezzoUnitario = excluded.PrezzoUnitario,
                    LastModified = excluded.LastModified
            `, [idProdotto, Prodotto, PrezzoUnitario, LastModified], (err) => {
                if (err) {
                    console.error("Errore durante la sincronizzazione del prodotto:", err.message);
                }
            });
        });
    });

    db.close((err) => {
        if (err) {
            console.error("Errore durante la chiusura del database:", err.message);
            res.status(500).send("Errore nella sincronizzazione.");
            return;
        }
        res.send("Sincronizzazione completata.");
    });
});

// Endpoint per esportare i prodotti
app.post('/export-products', (req, res) => {
    const idsString = req.body.ids;

    if (!idsString || typeof idsString !== "string") {
        console.error("IDs non è una stringa valida. Valore ricevuto:", idsString);
        return res.status(400).send("Formato degli IDs non valido.");
    }

    const ids = idsString.split(",").map(id => id.trim());
    console.log("IDs trasformati in array:", ids);

    const db = new sqlite3.Database('UpAndDown.db');

    db.all(
        `SELECT * FROM Prodotti WHERE idProdotto IN (${ids.map(() => '?').join(',')})`,
        ids,
        (err, rows) => {
            if (err) {
                console.error("Errore nel recupero dei prodotti:", err.message);
                return res.status(500).send("Errore nel recupero dei prodotti.");
            }

            if (rows.length === 0) {
                console.log("Nessun prodotto trovato per gli IDs forniti.");
                return res.status(404).send("Nessun prodotto trovato.");
            }

            const sanitizeForXML = value => {
                if (typeof value === 'string') {
                    return value.replace(/[<>&'"]/g, match => {
                        switch (match) {
                            case '<': return '&lt;';
                            case '>': return '&gt;';
                            case '&': return '&amp;';
                            case "'": return '&apos;';
                            case '"': return '&quot;';
                        }
                    });
                }
                return value;
            };

            const transformedRows = rows.map(row => {
                const sanitizedRow = {};
                for (const key in row) {
                    sanitizedRow[sanitizeForXML(key)] = sanitizeForXML(row[key]);
                }
                return sanitizedRow;
            });

            try {
                const builder = new xml2js.Builder({ rootName: 'UpAndDown' });
                const xml = builder.buildObject({ Prodotti: transformedRows });

                res.setHeader('Content-Type', 'application/xml');
                res.setHeader('Content-Disposition', 'attachment; filename="prodotti.xml"');
                res.send(xml);
            } catch (buildErr) {
                console.error("Errore nella costruzione dell'XML:", buildErr.message);
                res.status(500).send("Errore nella costruzione del file XML.");
            }
        }
    );

    db.close();
});



app.get('/download-acquisti-xml', (req, res) => {
  const db = new sqlite3.Database('UpAndDown.db');

  // Esegui query per ottenere tutti gli acquisti
  db.all("SELECT * FROM Acquisti", (err, rows) => {
      if (err) {
          console.error("Errore nella lettura del database:", err.message);
          res.status(500).send("Errore nella lettura del database.");
          return;
      }

      // Trasformiamo i record in formato XML
      const sanitizeForXML = value => {
          if (typeof value === 'string') {
              return value.replace(/[<>&'"]/g, match => {
                  switch (match) {
                      case '<': return '&lt;';
                      case '>': return '&gt;';
                      case '&': return '&amp;';
                      case "'": return '&apos;';
                      case '"': return '&quot;';
                  }
              });
          }
          return value;
      };

      const transformedRows = rows.map(row => {
          const sanitizedRow = {};
          for (const key in row) {
              sanitizedRow[sanitizeForXML(key)] = sanitizeForXML(row[key]);
          }
          return sanitizedRow;
      });

      try {
          const builder = new xml2js.Builder({ rootName: 'Acquisti' });
          const xml = builder.buildObject({ Acquisto: transformedRows });

          // Imposta intestazioni e invia file
          res.setHeader('Content-Type', 'application/xml');
          res.setHeader('Content-Disposition', 'attachment; filename="acquisti.xml"');
          res.send(xml);
      } catch (buildErr) {
          console.error("Errore nella costruzione dell'XML:", buildErr.message);
          res.status(500).send("Errore nella costruzione del file XML.");
      }
  });

  db.close();
});