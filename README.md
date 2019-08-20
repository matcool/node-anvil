# node-anvil
Simple package that can write region files in the [Minecraft anvil file format](https://minecraft.gamepedia.com/Anvil_file_format)

Only supports 1.14 and reading support is planned
# Installation
```
npm install node-anvil
```
# Usage
```js
const anvil = require('node-anvil');

let region = new anvil.Region(0, 0);

// 10x10 grass block platform
region.fill(new anvil.Block('minecraft', 'grass_block'), 0, 0, 0, 9, 0, 9);

// Oak log facing up
region.setBlock(new anvil.Block('minecraft', 'oak_log', { axis: 'y' }), 0, 1, 0);

// Persistent oak leaves on top of it
region.setBlock(new anvil.Block('minecraft', 'oak_leaves', { persistent: true }), 0, 2, 0);

// Tall grass consists of two tall_grass blocks, one with half: 'lower', and the other with half: 'upper'
region.setBlock(new anvil.Block('minecraft', 'tall_grass', { half: 'lower' }), 1, 1, 1);
region.setBlock(new anvil.Block('minecraft', 'tall_grass', { half: 'upper' }), 1, 2, 1);

// save() returns a Buffer with the data, but you can provide a file and it'll save there
region.save('r.0.0.mca');
```