

export default class RomBootLoader {
	zip = new JSZip();
	dict = {};
	constructor() {
		console.log('RomBootLoader - loaded');
	}

	load_zip = async(path) => {
		return await new Promise(function (resolve, reject) {
			JSZipUtils.getBinaryContent(path, function (err, data) {
				if (err) {
					reject(err);
				} else {
					resolve(data);
				}
			});
		});
	};

	async load_zip_set(archive) {
		
		var orgin = "https://archive.org/download/arcade-0223-merged/Arcade/roms.zip/roms%2F"
		if ("archive_orign" in archive) {
			orgin = archive.archive_orign
		}
		
		const zipData = await this.load_zip(orgin+`${archive.archive_name}.zip`);
		const zip = await JSZip.loadAsync(zipData);
		
		for (let i = 0; i < archive.mappings.length; i++) {
			const files = [];
			var rom_array = [];
			for (let j = 0; j < archive.mappings[i].roms.length; j++) {
				files.push(
					zip .file(archive.mappings[i].roms[j])
						.async('uint8array')
						.then(function (data) {
							console.log( archive.mappings[i].roms[j] )
							rom_array.push(data)
						})
				);
			}
			await Promise.all(files);
			
			// get target legnth
			let length = 0;
			rom_array.forEach(item => {
				length += item.length;
			});
			
			// Create a new array with total length and merge all source arrays.
			this.dict[archive.mappings[i].name] = new Uint8Array(length);
			let offset = 0;
			rom_array.forEach(item => {
				this.dict[archive.mappings[i].name].set(item, offset);
				offset += item.length;
			});
			
			
		}
	};


	async Load_Rom(settings) {
		
		const files = [];
		if ("romsets" in settings) {
			for (let i = 0; i < settings.romsets.length; i++)
				files.push( this.load_zip_set( settings.romsets[i] ) )
		} else {
			files.push( this.load_zip_set( { archive_name: settings.archive_name, mappings: settings.mappings } ) )
		}
		await Promise.all(files);
		
		
		
		this.dict.settings = settings
		
		
		// PRINTING INFO
		console.log("LOADIED: "+settings.display_name)
		console.log("BY:      "+settings.developer+" ("+settings.year+")")
		console.log("NOTES:   "+settings.Notes)
		
		
		// ON-SCREEN INFO
		var mylist = document.getElementById('DriverInfo');
		mylist.innerHTML = '';
		mylist.insertAdjacentHTML('beforeend', '<p>'+settings.display_name+'</p>');
		mylist.insertAdjacentHTML('beforeend', '<p>By: '+settings.developer+" ("+settings.year+')</p>');
		mylist.insertAdjacentHTML('beforeend', '<p><br>NOTES: '+settings.Notes+'</p>');
		
		
		
		
		return this.dict;
	}
}





