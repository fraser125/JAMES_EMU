
/*
 *
 *	Warp & Warp Sound Module
 *
 */

export default class WarpAndWarpSound {
	rate;
	gain;
	output = 0;
	reg1 = 0;
	reg2 = 0;
	voice = 0;
	freq = 0;
	phase = 0;

	constructor({gain = 0.1} = {}) {
		this.rate = Math.floor(0x8000000 * (48000 / audioCtx.sampleRate));
		this.gain = gain;
	}

	set_freq(data) {
		this.reg1 = data, this.freq = this.rate / (0x40 - (data & 0x3f)) | 0;
	}

	set_voice(data) {
		this.reg2 = data, this.voice = data >> 1 & 7;
	}

	update() {
		if ((this.reg2 & 0xf) !== 0xf && this.reg1 & 0x3f && this.reg2 !== 0x2d)
			this.phase = (this.phase + this.freq) % (8 - this.voice << 28);
		this.output = (this.phase >> 23 < 16 ? 1 : -1) * this.gain;
	};
}
