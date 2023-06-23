const fs = require('fs');

/**
 * Чтение данных из файла
 * 
 * @param  {string} path путь к файлу
 * @return {string}
*/
const readFileNoClear = path => fs.readFileSync(path, 'utf-8');

/**
 * Сканирует папки и файлы, возвращает объект со всеми путями
 * 
 * @param {string} path Путь
 * @return {object}
*/
const readDirAndFiles = path => {
	const obj = {
		files: [],
		dir: [],
		path: path
	}
	for (const f of fs.readdirSync(path)) {
		if (~ignoreFiles.indexOf(f)) continue;
		const p = `${path}/${f}`;
		const fstat = fs.statSync(p);
		if (fstat.isDirectory()) {
			const find = readDirAndFiles(p);
			obj.files.push(...find.files);
			obj.dir.push(...find.dir, p);
		}
		if (fstat.isFile()) obj.files.push(p);
	}
	return obj;
}

const args = process.argv;

if (args.length < 3)
	return 'Не указан путь к проекту!';

const path = args[2];

let config = {};

try {
	config = JSON.parse(fs.readFileSync(path + '/builder.config.json'));
}
catch(err) { console.log(err); }

const ignoreFiles = config.ignore || [];
const compileFolder = config.folder || 'build';
const mainFile = config.main || 'game.js';

// создание папки для финального билда:
if (!fs.existsSync([path, compileFolder].join('/')))
	fs.mkdirSync([path, compileFolder].join('/'));

// редактирование index.html
let indexHTML = readFileNoClear([path, 'index.html'].join('/'));
indexHTML = indexHTML.replaceAll(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

let gameJS = readFileNoClear([path, mainFile].join('/'));
try {
	const datapath = (/cfg\.datapath = \'([\.\/\w]+)\'/gi).exec(gameJS)[1];
	// создание папки для ресурсов:
	if (!fs.existsSync([path, compileFolder, datapath].join('/')))
		fs.mkdirSync([path, compileFolder, datapath].join('/'));

	// копирование ресурсов с исходников:
	const copyFiles = readDirAndFiles([path, datapath].join('/'));
	
	// создание папок из проекта:
	for (const dir of copyFiles.dir.reverse()) {
		const newdir = [path, compileFolder, datapath, dir.replaceAll(copyFiles.path + '/', '')].join('/');
		
		if (fs.existsSync(newdir)) continue;
		fs.mkdirSync(newdir);
	}
	// сопирование файлов из проекта:
	for (const file of copyFiles.files) {
		const newfile = [path, compileFolder, datapath, file.replaceAll(copyFiles.path + '/', '')].join('/');
		fs.copyFileSync(file, newfile);
		//console.log(newfile);
	}

	// загрузка скриптов:
	for (const match of gameJS.matchAll(/await Add\.script\(([\s\S]*?)\);/g)) {
		const scripts = match[1].replaceAll(/(\'|\s)/gi, '').split(',').filter(x => x),
					stack = [];

		for (const script of scripts) {
			const file = [path, script].join('/');
			stack.push(readFileNoClear(file));
		}

		gameJS = gameJS.replaceAll(match[0], stack.join('\n'));
	}

	// загрузка модулей:
	const modulepath = (/cfg\.modulepath = \'([\.\/\w]+)\'/gi).exec(gameJS)[1];
	let engJS = readFileNoClear(modulepath.split('/').slice(0, 2).join('/') + '/eng.js');

	for (const match of gameJS.matchAll(/await Add\.module\(([\s\S]*?)\);/g)) {
		const scripts = match[1].replaceAll(/(\'|\s)/gi, '').split(',').filter(x => x),
					stack = [];

		for (const script of scripts) {
			const file = [modulepath, script + '.js'].join('/');
			stack.push(readFileNoClear(file));
		}

		gameJS = gameJS.replaceAll(match[0], '');
		engJS += stack.join('\n');
	}

	// запись всех данных в один файл:
	indexHTML += `<script type = 'text/javascript'>${ engJS + '\n' + gameJS }</script>`;

	indexHTML = indexHTML.replaceAll(/\/{2}[A-zА-я0-9:!.,@#$%^&*()-=+_ ]+/gi, '');
	indexHTML = indexHTML.replaceAll(/\t/gi, '  ');
	indexHTML = indexHTML.replaceAll(/(\/\*[\s\S]*?\*\/)|(\/\*\*[\s\S]*?\*\/)/gi, '');
	indexHTML = indexHTML.replaceAll(/\n{2,}/gi, '\n');

	fs.writeFileSync([path, compileFolder, 'index.html'].join('/'), indexHTML);
}
catch(err) {
	console.error(err);
}