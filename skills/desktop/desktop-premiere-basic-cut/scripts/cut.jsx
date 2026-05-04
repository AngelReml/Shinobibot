// desktop-premiere-basic-cut — ExtendScript template.
// Variables INPUT / OUTPUT / START_SEC / END_SEC / PRESET / RESULT_PATH are
// substituted by skill.mjs at runtime via simple string replace.

#target premierepro
(function () {
    var result = { success: false };
    try {
        var input = '__INPUT__';
        var outFile = '__OUTPUT__';
        var startSec = parseFloat('__START_SEC__');
        var endSec = parseFloat('__END_SEC__');
        var presetName = '__PRESET__';
        var resultPath = '__RESULT_PATH__';

        if (!app.project) {
            // Open a fresh project
            var tmpProj = Folder.temp.fsName + '/shinobi-premiere.prproj';
            app.openDocument(tmpProj);
        }

        // Import source clip
        var ok = app.project.importFiles([input], false, app.project.rootItem, false);
        if (!ok) throw new Error('importFiles failed');
        var item = app.project.rootItem.children[app.project.rootItem.children.length - 1];

        // Create sequence from clip
        var seq = app.project.createNewSequenceFromClips('shinobi-cut', [item], app.project.rootItem);
        seq = app.project.activeSequence;

        // Trim track 1 to [start,end]
        var track = seq.videoTracks[0];
        if (track && track.clips.length > 0) {
            var clip = track.clips[0];
            clip.start.seconds = 0;
            clip.end.seconds = endSec - startSec;
            clip.inPoint.seconds = startSec;
            clip.outPoint.seconds = endSec;
        }

        // Export
        var preset = presetName || 'Match Source - High bitrate';
        var settings = app.encoder ? app.encoder.encodeSequence(seq, outFile, preset, 1, 1) : null;
        result.success = true;
        result.output = outFile;
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
