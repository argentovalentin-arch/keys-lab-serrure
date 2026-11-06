# KEYS Lab — La Serrure

Expérience du laboratoire de KEYS Performance, pilotée par le défilement :
le bruit, la grille, la clé, la serrure, puis la porte qui s’ouvre sur la lumière.
Particules calculées sur la carte graphique (three.js, WebGPU avec repli WebGL 2, TSL).

## Développement

```bash
npm install
npm run dev
```

Le site tourne sur http://localhost:5181.

Paramètres d’URL utiles pour tester :

- `?webgl` force le repli WebGL 2 sur un navigateur compatible WebGPU ;
- `?quality=high|medium|low` impose un niveau de qualité (et coupe l’ajustement automatique).

## Production

```bash
npm run build
```

Le site statique est généré dans `dist/`. Les chemins sont relatifs : il fonctionne
à la racine d’un domaine (sous-domaine dédié) comme dans un sous-dossier.

Chaque envoi sur la branche `main` le publie sur GitHub Pages (voir `.github/workflows/deploy.yml`) :
https://argentovalentin-arch.github.io/keys-lab-serrure/

## Organisation

- `src/core/story.ts` : toute la scénographie, déduite d’une seule valeur (la position dans le récit) ;
- `src/world/particles.ts` : simulation des particules sur la carte graphique ;
- `src/world/keyMesh.ts`, `src/world/door.ts` : la clé en métal, la porte et la serrure ;
- `src/core/quality.ts` : niveaux de qualité et baisse automatique si l’appareil ne suit pas.

Contrainte à respecter : la passe de calcul des particules utilise au plus trois buffers
de stockage, car le repli WebGL 2 n’en garantit que quatre en sortie.
