// projects.js · Content agent
// SAMPLE CONTENT: fictional projects for the demo. Clients, addresses, quotes and
// figures are invented; photos are free-licence stock (see assets/CREDITS.md).
//
// Also home of the tiny manifest helper shared by gallery.js and modal.js
// (D1: each module may fetch the manifest; this caches one promise per page).

export const PROJECTS = [
  {
    id: 'burkolas-budaors',
    title: 'Fürdőszoba-felújítás',
    category: 'burkolas',
    location: 'Budaörs',
    year: 2024,
    area: '14 m²',
    duration: '3 hét',
    scope: ['Régi burkolat bontása', 'Aljzatkiegyenlítés', 'Kenhető vízszigetelés', 'Falburkolás 120 × 60', 'Zuhanytálca nélküli zuhany'],
    materials: ['Porcelán gres 120 × 60', 'Flexibilis ragasztó C2TE S1', 'Epoxi fugázó', 'Rozsdamentes zuhanyfolyóka'],
    description:
      'Egy kilencvenes évekbeli ikerház emeleti fürdőszobáját bontottuk vissza a falazatig. A cél a kevesebb fuga és a szintkülönbség nélküli, zuhanytálca nélküli zuhany volt, ezért az aljzatot lejtésben, lézerrel húztuk ki.\n\n' +
      'A 120 × 60-as lapokat egyetlen fuga­hálóra terveztük, így a csempe illesztése a mosdópulttól a zuhanyfalig egy vonalban fut. A vizes zónákat kétrétegű kenhető szigeteléssel és hajlaterősítő szalaggal zártuk le.',
    quote: { text: 'Három hét alatt végeztek, és minden nap feltakarítottak maguk után. A fugák olyan egyenesek, hogy a szomszéd is megkérdezte, ki csinálta.', author: 'K. Anna' },
    photos: ['burkolas-budaors-1', 'burkolas-budaors-2', 'burkolas-budaors-3', 'burkolas-budaors-4'],
    cover: 'burkolas-budaors-1',
  },
  {
    id: 'burkolas-szentendre',
    title: 'Kültéri terasz és lépcső',
    category: 'burkolas',
    location: 'Szentendre',
    year: 2023,
    area: '38 m²',
    duration: '2,5 hét',
    scope: ['Lejtésbeton készítése', 'Vízszigetelés és vízelvezetés', 'Fagyálló burkolat', 'Lépcső élvédővel', 'Dilatációs hézagok'],
    materials: ['Fagyálló gres 60 × 60, R11', 'Kültéri ragasztó C2TE S1', 'Cementbázisú vízszigetelés', 'Alumínium élvédő'],
    description:
      'Egy dombra épült családi ház déli teraszát és a kertbe vezető hétfokos lépcsőt újítottuk fel. A régi burkolat alatt a víz évek óta a falba szivárgott, ezért a munka a lejtés és a vízelvezetés újragondolásával kezdődött.\n\n' +
      'Az új aljzat 1,5 %-os lejtést kapott egy rejtett vízelvezető csatorna felé. A csúszásmentes, fagyálló lapokat teljes felületű ragasztással raktuk, hogy alattuk ne maradjon üreg, ahol a víz megfagyhat.',
    quote: { text: 'Az első tél után sem vált el egyetlen lap sem, és végre nem áll a víz a terasz sarkában.', author: 'B. Gábor' },
    photos: ['burkolas-szentendre-1', 'burkolas-szentendre-2', 'burkolas-szentendre-3', 'burkolas-szentendre-4'],
    cover: 'burkolas-szentendre-1',
  },
  {
    id: 'burkolas-budapest-xi',
    title: 'Üzlethelyiség padlóburkolata',
    category: 'burkolas',
    location: 'Budapest XI.',
    year: 2024,
    area: '120 m²',
    duration: '10 munkanap',
    scope: ['Ipari aljzat csiszolása', 'Önterülő esztrich', 'Nagyformátumú padlóburkolat', 'Lábazat', 'Éjszakai munkavégzés'],
    materials: ['Rektifikált gres 120 × 120', 'Önterülő aljzatkiegyenlítő', 'Gyorskötő ragasztó C2FT', 'Cementbázisú fugázó 2 mm'],
    description:
      'Egy újbudai kávézó és bemutatóterem padlóját cseréltük úgy, hogy a mellette lévő üzletrész végig nyitva maradt. A munkát éjszakai és hétvégi ütemekre bontottuk, a poros fázisokat porelszívással és fóliafalakkal választottuk le.\n\n' +
      'A 120 × 120-as lapoknál a sík kulcskérdés, ezért az aljzatot önterülő réteggel 2 mm-en belülire hoztuk, és lapszintező rendszerrel raktuk. Gyorskötő ragasztóval a kész felület már másnap reggel járható volt.',
    quote: { text: 'Egyetlen nyitvatartási napot sem kellett kihagynunk, pedig az egész padló kicserélődött.', author: 'Sz. Dóra, üzletvezető' },
    photos: ['burkolas-budapest-xi-1', 'burkolas-budapest-xi-2', 'burkolas-budapest-xi-3'],
    cover: 'burkolas-budapest-xi-1',
  },
  {
    id: 'falazas-erd',
    title: 'Családi ház falazása',
    category: 'falazas',
    location: 'Érd',
    year: 2025,
    area: '168 m²',
    duration: '6 hét',
    scope: ['Kitűzés és szintezés', 'Teherhordó falak', 'Válaszfalak', 'Áthidalók és koszorú', 'Kéményfal'],
    materials: ['Kerámia falazóblokk 38 N+F', 'Hőszigetelő falazóhabarcs', 'Előregyártott áthidaló', 'C25/30 koszorúbeton'],
    description:
      'Kétszintes, nyeregtetős családi ház szerkezetkész állapotig tartó falazása a kész lemezalaptól. A hőszigetelő habarccsal rakott 38-as kerámiablokkal a falak külön hőszigetelés nélkül is teljesítik a mai előírásokat.\n\n' +
      'Minden sort lézerrel szinteztünk, a nyílásokat a gépészeti tervvel egyeztetve, centire hagytuk ki. A koszorút és az áthidalókat ugyanaz a csapat készítette, így a tetőácsok egy hét előnnyel kezdhettek.',
    quote: { text: 'A statikus az ellenőrzésen azt mondta, ritkán lát ilyen pontos falazást. Nekünk ez volt a legfontosabb.', author: 'Kovács Péter' },
    photos: ['falazas-erd-1', 'falazas-erd-2', 'falazas-erd-3'],
    cover: 'falazas-erd-1',
  },
  {
    id: 'falazas-godollo',
    title: 'Társasház szerkezetépítés',
    category: 'falazas',
    location: 'Gödöllő',
    year: 2023,
    area: '640 m²',
    duration: '11 hét',
    scope: ['Lépcsőházi falak', 'Lakáselválasztó hanggátló falak', 'Válaszfalak', 'Áthidalók', 'Állványozás'],
    materials: ['Kerámia falazóblokk 30 N+F', 'Hanggátló tégla 25', 'Pórusbeton válaszfalelem 10', 'Falazóhabarcs M10'],
    description:
      'Nyolclakásos, háromszintes társasház falazási munkái egy fővállalkozó alvállalkozójaként. A lakások közé hanggátló téglából épült fal került, hogy a szomszédok ne halljanak át egymáshoz.\n\n' +
      'A beruházó szoros ütemtervvel dolgozott, ezért két brigáddal, szintenként váltva haladtunk: amíg az egyik szinten a falazás folyt, a másikon már a födém zsaluzása készült. A határidőt egy nap tartalékkal tartottuk.',
    quote: { text: 'Egyetlen csúszás nélkül hozták a szinteket, pedig közben volt egy esős hónapunk is.', author: 'N. Tamás, projektvezető' },
    photos: ['falazas-godollo-1', 'falazas-godollo-2', 'falazas-godollo-3'],
    cover: 'falazas-godollo-1',
  },
  {
    id: 'falazas-pomaz',
    title: 'Kőburkolatú kerítésfal',
    category: 'falazas',
    location: 'Pomáz',
    year: 2024,
    area: '42 fm',
    duration: '4 hét',
    scope: ['Sávalap a kerítésnek', 'Zsalukő fal vasalással', 'Terméskő burkolat', 'Fedlap', 'Kapupillérek'],
    materials: ['Zsalukő 30', 'B500B betonacél', 'Andezit terméskő', 'Trasszcementes habarcs', 'Műkő fedlap'],
    description:
      'Egy pilisi telek utcafronti kerítése, két kapupillérrel és a gépkocsibeálló támfalával. A meredek utca miatt a falat lépcsőzetesen, öt szakaszban vezettük le, mindegyik szakasz külön sávalapot kapott.\n\n' +
      'A vasalt zsalukő mag elé helyi andezitből rakott terméskő burkolat került, kifugázva trasszcementtel, hogy ne jelenjenek meg sókivirágzások. A fedlapok csepegőéllel készültek, így a víz nem folyik le a kövön.',
    quote: null,
    photos: ['falazas-pomaz-1', 'falazas-pomaz-2', 'falazas-pomaz-3', 'falazas-pomaz-4'],
    cover: 'falazas-pomaz-1',
  },
  {
    id: 'alapozas-dunakeszi',
    title: 'Sávalap családi háznak',
    category: 'alapozas',
    location: 'Dunakeszi',
    year: 2025,
    area: '146 m² alapterület',
    duration: '3 hét',
    scope: ['Földmunka és kitűzés', 'Szerelőbeton', 'Vasszerelés', 'Betonozás mixerrel', 'Lábazati szigetelés'],
    materials: ['C25/30 XC2 beton', 'B500B betonacél', 'Bitumenes lemezszigetelés', 'XPS lábazati hőszigetelés'],
    description:
      'Egy földszintes, alápincézetlen családi ház sávalapja homokos kavics talajon. A talajmechanikai szakvélemény alapján 80 cm széles, 1,20 m mély alaptesteket terveztünk, a fagyhatár alá.\n\n' +
      'A vasszerelést a statikus a betonozás előtt a helyszínen átvette. A betont mixerrel és pumpával, egy nap alatt, szakaszhatár nélkül öntöttük be, a lábazatot pedig kétrétegű bitumenes szigeteléssel és XPS-sel zártuk.',
    quote: { text: 'Minden lépésről fotót kaptunk, még a vasszerelésről is, mielőtt rákerült a beton.', author: 'H. Zsófia' },
    photos: ['alapozas-dunakeszi-1', 'alapozas-dunakeszi-2', 'alapozas-dunakeszi-3', 'alapozas-dunakeszi-4'],
    cover: 'alapozas-dunakeszi-1',
  },
  {
    id: 'alapozas-budakeszi',
    title: 'Lemezalap lejtős telken',
    category: 'alapozas',
    location: 'Budakeszi',
    year: 2024,
    area: '182 m²',
    duration: '4 hét',
    scope: ['Tereprendezés', 'Tömörített kavicságy', 'Talajnedvesség elleni szigetelés', 'Kétsoros vasalás', 'Lemezalap betonozása'],
    materials: ['C30/37 XC2 beton', 'B500B hegesztett háló', 'Bitumenes vastaglemez', 'Zúzott kő 0/32'],
    description:
      'Agyagos, lejtős telekre tervezett ház, ahol a sávalap egyenlőtlen süllyedést okozott volna. A statikus javaslatára 35 cm vastag, kétsoros vasalású lemezalap készült tömörített kavicságyra.\n\n' +
      'A lejtő miatt a telek felső részén támfalat és ideiglenes vízelvezetést építettünk, hogy az esővíz ne mossa alá a munkagödröt. A 64 m³ betont egyetlen ütemben öntöttük, utókezeléssel és takarással.',
    quote: { text: 'Egy nehéz telekre kerestünk valakit, aki nem ijed meg tőle. Pontosan elmagyarázták, mi miért kell.', author: 'T. Márton' },
    photos: ['alapozas-budakeszi-1', 'alapozas-budakeszi-2', 'alapozas-budakeszi-3'],
    cover: 'alapozas-budakeszi-1',
  },
  {
    id: 'alapozas-vac',
    title: 'Pontalap csarnoképülethez',
    category: 'alapozas',
    location: 'Vác',
    year: 2023,
    area: '24 pontalap',
    duration: '2 hét',
    scope: ['Geodéziai kitűzés', 'Kehelyalapok zsaluzása', 'Vasszerelés', 'Betonozás', 'Horgonycsavarok elhelyezése'],
    materials: ['C30/37 beton', 'B500B betonacél', 'Rétegelt zsaluzólemez', 'Horgonycsavar M24'],
    description:
      'Egy könnyűszerkezetes tároló­csarnok huszonnégy kehelyalapja, előregyártott oszlopokhoz. A pontosság itt milliméterekben mérhető: a horgonycsavarok helyét geodéta tűzte ki és ellenőrizte betonozás előtt és után is.\n\n' +
      'A zsaluzatot újrahasználható elemekből állítottuk össze, így két hét alatt, ütemezve készült el mind a huszonnégy alap. Az acélszerkezet szerelője ezután egyetlen korrekció nélkül állíthatta fel az oszlopokat.',
    quote: null,
    photos: ['alapozas-vac-1', 'alapozas-vac-2', 'alapozas-vac-3', 'alapozas-vac-4'],
    cover: 'alapozas-vac-1',
  },
];

export const getProject = (id) => PROJECTS.find((p) => p.id === id) || null;

export const CATEGORY_LABEL = { burkolas: 'Burkolás', falazas: 'Falazás', alapozas: 'Alapozás' };
export const CATEGORY_MORE = {
  burkolas: 'Több burkolási munka',
  falazas: 'Több falazási munka',
  alapozas: 'Több alapozási munka',
};

/* ---------- manifest (D1/D9) ---------- */
const MANIFEST_URL = 'assets/photos/manifest.json';
let manifestPromise = null;

/** Resolves to a Map<id, photo>; an empty Map if the manifest is missing. Never rejects. */
export function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL)
      .then((r) => (r.ok ? r.json() : { photos: [] }))
      .catch(() => ({ photos: [] }))
      .then((m) => new Map((m.photos || []).map((p) => [p.id, p])));
  }
  return manifestPromise;
}

/** A photo record for an id, falling back to the D9 path convention. */
export function photoFor(map, id) {
  const p = map.get(id);
  if (p) return { thumb: p.thumb || p.file, ...p };
  return {
    id, file: `assets/photos/${id}.jpg`, thumb: `assets/photos/thumbs/${id}.jpg`,
    w: 1920, h: 1280, alt: '', caption: '', credit: '', license: '', missing: true,
  };
}

/**
 * Reconcile static <img data-photo> tags with the manifest (alt, srcset widths)
 * and manage the fade-in: images that are not yet decoded get .is-pending.
 */
export async function hydratePhotos(root = document) {
  const imgs = Array.from(root.querySelectorAll('img[data-photo]'));
  imgs.forEach(watchImage);
  const map = await loadManifest();
  if (!map.size) return;
  imgs.forEach((img) => {
    const p = map.get(img.dataset.photo);
    if (!p) return;
    const thumb = p.thumb || p.file;
    const tw = p.w >= p.h ? 640 : Math.round((640 * p.w) / p.h);
    const srcset = `${thumb} ${tw}w, ${p.file} ${p.w}w`;
    if (img.getAttribute('srcset') !== srcset) img.setAttribute('srcset', srcset);
    if (!img.src.endsWith(thumb)) img.src = thumb;
    if (p.alt && !img.hasAttribute('data-alt-fixed')) img.alt = p.alt;
  });
}

export function watchImage(img) {
  if (img.dataset.watched) return;
  img.dataset.watched = '1';
  const done = () => { img.classList.remove('is-pending', 'is-missing'); img.classList.add('is-loaded'); };
  const fail = () => { img.classList.remove('is-pending', 'is-loaded'); img.classList.add('is-missing'); };
  img.addEventListener('load', done);
  img.addEventListener('error', fail);
  if (img.complete) { img.naturalWidth > 0 ? done() : img.currentSrc && fail(); return; }
  img.classList.add('is-pending');
}
