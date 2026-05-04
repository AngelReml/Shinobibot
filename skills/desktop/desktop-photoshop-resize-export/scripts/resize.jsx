// desktop-photoshop-resize-export — ExtendScript template.
// Variables INPUT / OUTPUT / WIDTH / HEIGHT / QUALITY / KEEP_ASPECT / RESULT_PATH replaced by skill.mjs.

#target photoshop
(function () {
    var result = { success: false };
    try {
        var input = '__INPUT__';
        var outFile = '__OUTPUT__';
        var width = parseInt('__WIDTH__', 10);
        var heightArg = parseInt('__HEIGHT__', 10);
        var quality = parseInt('__QUALITY__', 10);
        var keepAspect = '__KEEP_ASPECT__' === '1';

        var doc = app.open(File(input));
        var origW = doc.width.value;
        var origH = doc.height.value;
        var newH = heightArg;
        if (keepAspect || isNaN(newH) || newH <= 0) {
            newH = Math.round(origH * (width / origW));
        }
        doc.resizeImage(UnitValue(width, 'px'), UnitValue(newH, 'px'), null, ResampleMethod.BICUBIC);

        var jpgFile = new File(outFile);
        var saveOpts = new JPEGSaveOptions();
        saveOpts.quality = isNaN(quality) ? 10 : quality;
        saveOpts.embedColorProfile = true;
        saveOpts.formatOptions = FormatOptions.STANDARDBASELINE;
        doc.saveAs(jpgFile, saveOpts, true, Extension.LOWERCASE);
        doc.close(SaveOptions.DONOTSAVECHANGES);

        result.success = true;
        result.output = outFile;
        result.width = width;
        result.height = newH;
    } catch (e) {
        result.success = false;
        result.error = String(e && e.message ? e.message : e);
    }
    var f = new File('__RESULT_PATH__');
    f.encoding = 'UTF-8';
    f.open('w');
    f.write(JSON.stringify(result));
    f.close();
})();
