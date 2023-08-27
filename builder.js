const fs = require('fs');
const admZip = require('adm-zip');


console.info = function(...args) {
  console.log('\x1b[33m', ...args);
}
console.error = function(...args) {
  console.log('\x1b[31m', ...args);
}
console.success = function(...args) {
  console.log('\x1b[32m', ...args);
}

/**
 * Чтение данных из файла
 * 
 * @param  {string} path путь к файлу
 * @return {string}
*/
const readFileNoClear = path => fs.readFileSync(path, 'utf-8');

/**
 * Кодирование файла в base64 строку
 * 
 * @param {string} path Путь к файлу
 * @return {string}
*/
const fileToBase64 = path => fs.readFileSync(path, {encoding: 'base64'});

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
catch(err) { console.error(err); }

const ignoreFiles = config.ignore || [];
const compileFolder = config.folder || 'build';
const mainFile = config.main || 'game.js';
const merge = config.merge || false;
const base64 = config.base64 || false;
const ads = config.ads || [];

// создание папки для финального билда:
if (!fs.existsSync([path, compileFolder].join('/')))
  fs.mkdirSync([path, compileFolder].join('/'));

// редактирование index.html
let indexHTML = readFileNoClear([path, 'index.html'].join('/'));
indexHTML = indexHTML.replaceAll(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

let gameJS = readFileNoClear([path, mainFile].join('/'));
try {

  console.info(`Очистка от старых .zip файлов`);
  for (const ad of ads) {
    const _file = [path, compileFolder, `${ad}.zip`].join('/');
    if (!fs.existsSync(_file)) continue;
    fs.unlinkSync(_file);
    console.success(`${ad}.zip удален!`);
  }

  const datapath = (/cfg\.datapath = \'([\.\/\w]+)\'/gi).exec(gameJS)[1];

  // создание папки для ресурсов:
  if (!fs.existsSync([path, compileFolder, datapath].join('/'))) {
    console.info('создание папки для ресурсов...');
    fs.mkdirSync([path, compileFolder, datapath].join('/'));
  }

  // копирование ресурсов с исходников:
  const copyFiles = readDirAndFiles([path, datapath].join('/'));
  
  // создание папок из проекта:
  for (const dir of copyFiles.dir.reverse()) {
    const newdir = [path, compileFolder, datapath, dir.replaceAll(copyFiles.path + '/', '')].join('/');
    
    if (fs.existsSync(newdir)) continue;
    fs.mkdirSync(newdir);
    console.info(`создание папки ${newdir} в ${compileFolder}...`);
  }
  console.info('перенос файлов...');
  // копирование файлов из проекта:
  for (const file of copyFiles.files) {
    const newfile = [path, compileFolder, datapath, file.replaceAll(copyFiles.path + '/', '')].join('/');
    fs.copyFileSync(file, newfile);
    console.success(`${file} -> ${newfile}`);
  }
  console.success('файлы перенесены!');
  if (merge) {
    console.info('слияние скриптов...')
    // загрузка скриптов:
    for (const match of gameJS.matchAll(/await Add\.script\(([\s\S]*?)\);/g)) {
      const scripts = match[1].replaceAll(/(\'|\s)/gi, '').split(',').filter(x => x),
            stack = [];

      for (const script of scripts) {
        const file = [path, script].join('/');
        stack.push(readFileNoClear(file));
      }

      gameJS = gameJS.replaceAll(match[0], stack.join('\n'));
      console.success(`${match[1]} добавлен в очередь...`);
    }

    // перенос файлов в base64 строку:
    if (base64) {
      console.info('конвертирование изображений в base64...');
      // изображения:
      for (const match of gameJS.matchAll(/(?<!\$\{.*)Add\.image\((\s*'.*?'(\s*,\s*'.*?')*\s*)\);/g)) {
        const images = match[1].replaceAll(/(\'|\s)/gi, '').split(',').filter(x => x),
              stack = [];

        for (const image of images) {
          const file = [path, image].join('/');
          const arr = file.split('/');

          const urlImgID = arr.slice(arr.indexOf(datapath) + 1);
          urlImgID[urlImgID.length - 1] = urlImgID[urlImgID.length - 1].split('.')[0];
          
          stack.push(`await Add.imageURL('${urlImgID.join('.')}', 'data:@file/png;base64,${fileToBase64(file)}');`);
          //stack.push(`data:@file/png;base64,${fileToBase64(file)}`);
          console.success(`${image} сконвертирован в base64...`);
        }

        gameJS = gameJS.replaceAll(match[0], stack.join('\n'));
        console.success('конвертирование завершено!');
      }
    }
    console.info('слияние модулей и движка...');
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

      console.success(`модуль ${script} добавлен в очередь...`);

      gameJS = gameJS.replaceAll(match[0], '');
      engJS += stack.join('\n');
    }


    // запись всех данных в один файл:
    indexHTML += `<script type = 'text/javascript'>${ engJS + '\n' + gameJS }</script>`;
    fs.writeFileSync([path, compileFolder, 'index.html'].join('/'), indexHTML);
  } else {
    // сборка проекта без объединения всех файлов в один:
    console.info('подготовка к переносу файлов... (без слияния)');

    const modulepath = (/cfg\.modulepath = \'([\.\/\w]+)\'/gi).exec(gameJS)[1];
    let engJS = modulepath.split('/').slice(0, 2).join('/') + '/eng.js';
    
    if (!fs.existsSync([path, compileFolder, '42eng'].join('/'))) {
      fs.mkdirSync([path, compileFolder, '42eng'].join('/'));
      console.success('папка движка была создана!');
    }

    if (!fs.existsSync([path, compileFolder, '42eng', 'modules'].join('/'))) {
      fs.mkdirSync([path, compileFolder, '42eng', 'modules'].join('/'));
      console.success('папка для модулей была создана!');
    }

    console.info('добавление модулей...');
    for (const match of gameJS.matchAll(/await Add\.module\(([\s\S]*?)\);/g)) {
      const scripts = match[1].replaceAll(/(\'|\s)/gi, '').split(',').filter(x => x);

      for (const script of scripts) {
        const file = [modulepath, script + '.js'].join('/');
        fs.copyFileSync(file, [path, compileFolder, '42eng', 'modules', `${script}.js`].join('/'));
        console.success(`модуль ${script} добавлен в папку модулей!`);
      }
    }

    fs.copyFileSync(engJS, [path, compileFolder, '42eng', 'eng.js'].join('/'));
    console.success('42eng добавлен и готов к работе!');    

    indexHTML += `<script type = 'text/javascript' src = '${['.', '42eng', 'eng.js'].join('/')}'></script>`;
    indexHTML += `<script type = 'text/javascript' src = '${['.', mainFile].join('/')}'></script>`;

    gameJS = gameJS.replaceAll(/cfg\.modulepath = \'([\.\/\w]+)\'/gi, `cfg.modulepath = '${['.', '42eng', 'modules', ''].join('/')}'`);

    fs.writeFileSync([path, compileFolder, mainFile].join('/'), gameJS);
    fs.writeFileSync([path, compileFolder, 'index.html'].join('/'), indexHTML);
    
  }

  // интеграция с sdk площадок:
  const zips = [];
  for (const ad of ads) {
    console.info(`упаковка архива для ${ad} SDK...`);
    
    const _ads = (/await ads\.set\(([\s\S]*?)\);/g).exec(gameJS);
    if (!_ads) {
      console.error('ошибка! не найдена строка ads.set');
      continue;
    }

    const newstr = _ads[0].replace(_ads[1].split(', ')[0], `'${ad}'`);

    const _localGameJS = gameJS.replace(_ads[0], newstr);
    fs.writeFileSync([path, compileFolder, mainFile].join('/'), _localGameJS);
    try {
      zips.push([new admZip(), ad]);
      zips[zips.length - 1][0].addLocalFolder([path, compileFolder].join('/'));

      
      
    }
    catch(err) {
      console.error('ошибка!', err);
    }
  }
  zips.forEach(zip => {
    zip[0].writeZip(`${[path, compileFolder].join('/')}/${zip[1]}.zip`);
    console.success(`${zip[1]}.zip готов!`);
  });
  console.success('сборка проекта завершена!');
}
catch(err) {
  console.error(err);
}