/*
 *
 *	Krokha ["Baby"]
 *
 */

import {init} from '../libs/EMU.js/main.js';
import RomBootLoader from '../libs/RomBootLoader/RomBootLoader.js';
import I8080 from '../libs/EMU.js/devices/CPU/i8080.js';
let game, sound;

class Krokha_Baby {
	width = 48*8;
	height = 32*8;
	cxScreen = this.width;
	cyScreen = this.height;
	xOffset = 0;
	yOffset = 0;
	rotate = 0;

	fReset = false;
	fDIPSwitchChanged = true;
	fStart1P = 0;
	fStart2P = 0;
	
	speaker = 0;
	input = 0xff;
	
	rgb = Int32Array.of( 0xff000000, 0xffffffff );

	ram = new Uint8Array(0x800).addBase();
	io = new Uint8Array(0x100);
	cpu_irq = false;
	cpu_irq2 = false;

	bitmap = new Int32Array(this.width * this.height).fill(0xff000000);
	updated = false;
	shifter = {shift: 0, reg: 0};
//	screen_red = false;

	cpu = new I8080(Math.floor(19968000 / 10));
	scanline = {rate: 256 * 60, frac: 0, count: 0, execute(rate, fn) {
		for (this.frac += this.rate; this.frac >= rate; this.frac -= rate)
			fn(this.count = this.count + 1 & 255);
	}};

	constructor() {
		//SETUP CPU
		const range = (page, start, end, mirror = 0) => (page & ~mirror) >= start && (page & ~mirror) <= end;

		for (let page = 0; page < 0x20; page++)
			this.cpu.memorymap[page].base = PRG.base[page];
		
		
		for (let page = 0; page < 0x10; page++){
			// likely a better way to do this
			this.cpu.memorymap[page+0xe0].read = (addr) => {
				addr = addr%0x800
				return this.ram[addr]
			};
			this.cpu.memorymap[page+0xe0].write = (addr, data) => {
				addr = addr%0x800
				this.ram[addr] = data;
			};
		}
		
		// SOUND (needs bleeper emulator)
		this.cpu.memorymap[0xf7].write = (addr, data) => { // 0xf7ff
			if (0xf7ff){
				this.speaker = data
			}
		};
		// INPUTS
		this.cpu.memorymap[0xf7].read = (addr) => { // 0xf7ff
			return this.input
		};
	}

	execute(audio, length) {
		const tick_rate = 192000, tick_max = Math.ceil(((length - audio.samples.length) * tick_rate - audio.frac) / audio.rate);
		const update = () => { this.makeBitmap(true), this.updateStatus(), this.updateInput(); };
		for (let i = 0; !this.updated && i < tick_max; i++) {
			this.cpu.execute(tick_rate);
			this.scanline.execute(tick_rate, (vpos) => { vpos === 96 && (this.cpu_irq2 = true), vpos === 224 && (update(), this.cpu_irq = true); });
			audio.execute(tick_rate);
		}
	}

	reset() {
		this.fReset = true;
		console.log("RESET")
		this.input = 0xff
	}

	updateStatus() {
		//DIP SWITCH UPDATE
		if (this.fDIPSwitchChanged) {
			this.fDIPSwitchChanged = false;
			this.fReset = true;
		}

		//RESET
		if (this.fReset) {
			this.fReset = false;
			this.cpu_irq = this.cpu_irq2 = false;
			this.ram.fill(0xff);
			this.cpu.reset();
		}
		return this;
	}

	updateInput() {
	}
	
	key(index,isdown) {
		if (isdown){
			this.input &= ~index
		} else {
			this.input |=  index
		}
	}
	triggerA(fDown) {
		this.key(0x01,fDown)
	}
	
	up(fDown) {
		this.key(0x02,fDown)
	}
	down(fDown) {
		this.key(0x04,fDown)
	}
	right(fDown) {
		this.key(0x08,fDown)
	}
	left(fDown) {
		this.key(0x10,fDown)
	}
	
	start1P(fDown) {
		this.key(0xe0,fDown) // unused key?
		console.log("UNKNOWN UNUSED KEY '0xE0' PRESSED")
	}

	draw_tile(x,y,index) {
		index = index*8
		for (let i = 0; i < 8; i++){
			let gfx = CHR[index];
			for (let j = 0; j < 8; j++){
				this.bitmap[ (((y*8)+i)*this.width)+(7-j)+(x*8) ] = this.rgb[ (gfx>>j)&1 ];
			}
			index += 1;
		}
	}
	makeBitmap(flag) {
		if (!(this.updated = flag))
			return this.bitmap;
		
		var offs = 32*16
		for (let x = 0; x < 48; x++){
			for (let y = 0; y < 32; y++){
				let val = this.ram[offs];
				this.draw_tile( x,y, val )
				offs += 1
			}
		}
		

		return this.bitmap;
	}
}

/*
 *
 *	Krokha ["Baby"]
 *
 */
 

const RBL = new RomBootLoader();

const RomSetInfo = [

	{
		// Mame name  'krokha'
		display_name: 'Krokha "Baby"',
		developer: 'SKB Kontur',
		year: '1990',
		Notes: 'TODO: ADD SOUND (backing code is done)',

		driver: Krokha_Baby,
		romsets: [
			{
				archive_name: 'krokha',
				archive_orign: './',
				mappings: [
				{
					name: 'PRG',
					roms: ['bios.bin'],
				},
				{
					name: 'CHR',
					roms: ['font.bin'],
				},
				]
			},
		]
	},
]


let ROM_INDEX = RomSetInfo.length-1
console.log("TOTAL ROMSETS AVALIBLE: "+RomSetInfo.length)
console.log("GAME INDEX: "+(ROM_INDEX+1))

let PRG, CHR;
window.addEventListener('load', () =>
	RBL.Load_Rom(RomSetInfo[ROM_INDEX]).then((ROM) => {
		
		PRG = ROM["PRG"].addBase();
		CHR = ROM["CHR"].addBase();
	
		game  = new ROM.settings.driver();
		sound = [];
		
		init({game, sound});
		
	})
);

