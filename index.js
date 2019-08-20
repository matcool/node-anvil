const zlib = require('zlib');
const nbt = require('nbt-ts');
const fs = require('fs');
const { shallowEqualObjects } = require('shallow-equal');

class Block {
    constructor(namespace, id, properties) {
        this.namespace = namespace;
        this.id = id;
        this.properties = properties || {};
    }
    get name() {
        return this.namespace + ':' + this.id;
    }
    equals(other) {
        return this.namespace == other.namespace && this.id == other.id && shallowEqualObjects(this.properties, other.properties);
    }
}

class Section {
    constructor(y) {
        this.y = y;
        this.blocks = Array(4096).fill(null);
        this.air = new Block('minecraft', 'air');
    }
    inside(x, y, z) {
        return x >= 0 && x <= 15 && y >= 0 && y <= 15 && z >= 0 && z <= 15
    }
    setBlock(block, x, y, z) {
        if (!this.inside(x, y, z)) throw new Error('Coordinates are outside section');
        let index = y * 256 + z * 16 + x;
        return this.blocks[index] = block;
    }
    getBlock(x, y, z) {
        if (!this.inside(x, y, z)) throw new Error('Coordinates are outside section');
        let index = y * 256 + z * 16 + x;
        return this.blocks[index] || this.air;
    }
    palette() {
        let palette = [];
        if (this.blocks.includes(null)) palette.push(this.air);
        for (let block of this.blocks) {
            if (block !== null && !palette.includes(block)) {
                palette.push(block);
            }
        }
        return palette;
    }
    blockstates(palette) {
        palette = palette || this.palette();
        // Get the bit length of the palette length
        let bits = Math.max(palette.length.toString(2).length, 4);
        let states = [];
        let current = '';
        const to_bin = n => '0'.repeat(bits - n.toString(2).length) + n.toString(2);
        for (let block of this.blocks) {
            let index = palette.indexOf(block === null ? this.air : block);
            let b = to_bin(index);
            if (current.length + bits > 64) {
                let leftover = current.length + bits - 64;
                states.push(BigInt('0b'+b.slice(bits-leftover, bits)+current));
                current = b.slice(0, leftover);
            } else {
                current = b + current;
            }
        }
        states.push(BigInt('0b'+current));
        return states
    }
    save() {
        let palette = this.palette();
        let pal = [];
        for (let block of palette) {
            let pro = {};
            for (let key of Object.keys(block.properties)) {
                pro[key] = block.properties[key].toString();
            }
            let b = {
                Name: block.name
            };
            if (Object.keys(pro).length > 0) b.Properties = pro;
            pal.push(b);
        }
        let blockstates = this.blockstates();
        return {
            Y: this.y,
            Palette: pal,
            BlockStates: new BigInt64Array(blockstates)
        }
    }
}

class Chunk {
    constructor(x, z) {
        this.x = x;
        this.z = z;
        this.sections = [];
        this.version = 1976;
    }
    getSection(y) {
        if (y < 0 || y > 15) throw new Error('Invalid Y index');
        for (let section of this.sections) {
            if (section.y === y) return section;
        }
    }
    getBlock(x, y, z) {
        if (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y > 255) throw new Error('Coordinates are outside chunk');
        let section = this.getSection(Math.floor(y / 16));
        if (!section) return null;
        return section.getBlock(x, y % 16, z);
    }
    setBlock(block, x, y, z) {
        if (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y > 255) throw new Error('Coordinates are outside chunk');
        let section = this.getSection(Math.floor(y / 16));
        if (!section) {
            section = new Section(Math.floor(y / 16));
            this.sections.push(section);
        }
        section.setBlock(block, x, y, z);
    }
    save() {
        let sections = [];
        for (let section of this.sections) {
            let p = section.palette();
            if (p.length === 1 && p[0].name === 'minecraft:air') continue;
            sections.push(section.save());
        }
        return {
            DataVersion: this.version,
            Level: {
                xPos: this.x,
                zPos: this.z,
                Status: 'full',
                isLightOn: new nbt.Byte(1),
                Sections: sections
            }
        }
    }
}
class Region {
    constructor(x, z) {
        this.x = x;
        this.z = z;
        this.chunks = Array(1024).fill(null);
    }
    inside(x, y, z, chunk=false){
        let factor = chunk ? 32 : 512;
        let rx = Math.floor(x / factor);
        let rz = Math.floor(z / factor);
        return rx === this.x && rz === this.z && y >= 0 && y <= 255;
    }
    getChunk(x, z) {
        if (!this.inside(x, 0, z, true)) return;
        return this.chunks[z % 32 * 32 + x % 32];
    }
    addChunk(chunk) {
        if (!this.inside(chunk.x, 0, chunk.z, true)) {
            throw new Error('Chunk does not belong in this region');
        }
        this.chunks[chunk.z % 32 * 32 + chunk.x % 32] = chunk;
    }
    setBlock(block, x, y, z) {
        if (!this.inside(x, y, z)) throw new Error('Coordinates are outside region');
        let cx = Math.floor(x / 16);
        let cz = Math.floor(z / 16);
        let chunk = this.getChunk(cx, cz);
        if (!chunk) {
            chunk = new Chunk(cx, cz);
            this.addChunk(chunk);
        }
        chunk.setBlock(block, x % 16, y, z % 16);
    }
    fill(block, x1, y1, z1, x2, y2, z2, ignoreOutside=false) {
        if (!ignoreOutside) {
            if (!this.inside(x1, y1, z1)) throw new Error('First coordinates are outside region');
            if (!this.inside(x2, y2, z2)) throw new Error('Second coordinates are outside region');
        }
        // this big mess it so it goes from a1 to a2 including both endpoints
        // and making sure to increase or decrease
        for (let y = y1; y2 > y1 ? y <= y2 : y >= y2; y += y2 > y1 ? 1 : -1) {
            for (let z = z1; z2 > z1 ? z <= z2 : z >= z2; z += z2 > z1 ? 1 : -1) {
                for (let x = x1; x2 > x1 ? x <= x2 : x >= x2; x += x2 > x1 ? 1 : -1) {
                    if (ignoreOutside && !this.inside(x, y, z)) continue;
                    this.setBlock(block, x, y, z);
                }
            }
        }
    }
    save(file) {
        let chunksData = [];
        for (let chunk of this.chunks) {
            if (!chunk) {
                chunksData.push(null);
                continue;
            }
            let chunkData = nbt.encode('', chunk.save());
            chunkData = zlib.deflateSync(chunkData);
            chunksData.push(chunkData);
        }
        let offsets = [];
        let totalLength = 0;
        chunksData = chunksData.map(data => {
            if (!data) {
                offsets.push(null);
                return null;
            }
            // 4 bytes are for the length, 1 for compression type and the rest are the compressed nbt data
            let length = 4 + 1 + data.length;
            offsets.push([Math.floor(totalLength / 4096), Math.ceil(length / 4096)]);

            // Make sure its a multiple of 4KiB
            if (length % 4096 !== 0) length += 4096 - (length % 4096);
            totalLength += length;

            let b = Buffer.alloc(length);
            b.writeIntBE(data.length + 1, 0, 4);
            // Compression type as zlib
            b.writeIntBE(2, 4, 1);
            data.copy(b, 5, 0, data.length);
            return b;
        }).filter(i => !!i);
        let chunksBuffer = Buffer.concat(chunksData, totalLength);
        let locationsHeader = Buffer.concat(offsets.map(off => {
            if (off) {
                let b = Buffer.alloc(4);
                b.writeIntBE(off[0]+2, 0, 3);
                b.writeIntBE(off[1], 3, 1);
                return b;
            } else {
                return Buffer.alloc(4);
            }
        }, 4096));
        let timestampsHeader = Buffer.alloc(4096);
        let final = Buffer.concat([locationsHeader, timestampsHeader, chunksBuffer], 8192+chunksBuffer.length);
        if (file) fs.writeFile(file, final, err => {
            if (err) throw err;
        });
        return final;
    }
}
module.exports = {
    Block,
    Section,
    Chunk,
    Region
}