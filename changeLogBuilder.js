/**
 * @Name ChangeLogBuilder
 * @Date 2/1/2023
 * @Author Daniel Llewellyn
 * @Description This is a node.js application that is used for assisting with Salesforce devops. It's purpose is to allow for easy downloading of change sets and record their contents, along with merging them together
 * to create a 'merged' change set that contains all of the other ones. This exists because when working on a Salesforce project where some of contributors are unfamiliar with SFDX/Source control it can be difficult to
 * integrate their work into the source control repo. The idea with this is that the contributors can simply create a change set within Salesforce and this script can pull down their changes and record all of their modifications
 * in an organized way that makes it easy to then add and commit their work into the source repo. When this script is run it can either automatically get all change sets by scraping the change set UI page, or it can be given
 * a discrete list of change sets to download (automaticallyFetchChangeSetNames true/false). Once the names of the change sets are defined the script will then download them all using the SFDX CLI utilities. After all the change
 * sets have been downloaded, three files are created, package.xml, package.json, and package.csv. The package.xml is a manifest that can be used to deploy all the content from all the change sets. The package.json file is just
 * a different notation of the same data that currently doesn't have a direct use I'm aware of but I figured why not. The package.csv a file that again contains all the contents from all the packages in a more human readable
 * way that can be delivered at the end of a project, or to help keep track of everything that's been modified. Finally the script can optionally create a 'merged' folder that contains all the contents of all the packages. This
 * paired with the merged package.xml file allows you to easily deploy all contents of all the change sets in one operation.
 */

const packageStructure = '<?xml version="1.0" encoding="UTF-8"?><Package xmlns="http://soap.sforce.com/2006/04/metadata"><version>48.0</version></Package>';
const configFileName = "config.json";
const xml2js = require("xml2js");
const parseString = xml2js.parseString;
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { promisify } = require("util");
const { resolve } = require("path");
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const cheerio = require("cheerio");

//text string that denotes the beginning of the change set entries in the scraped HTML content.
const startPosition = '<div class="pbSubsection">';
//text string that denotes the end of the change set entries in the scraped HTML content.
const endPosition = '<div class="pbFooter secondaryPalette">';

let config = {
    skipExistingChangeSets: true,
    rootFolder: "packages",
    forcePackageVersion: 50,
    automaticallyFetchChangeSetNames: true,
    changesetJSONFile: "changeSetNames.json",
    createMergedPackage: true,
    mergedPackageFolder: "__mergedPackage",
    username: "",
    outputFolder: "results",
};

/**
 * @Description Entry point of script
 */
async function init() {
    log("                                    Change Log Builder 1.0!\r\n", true, "green");
    log("                                     Author: Dan Llewellyn\r\n", true);

    let d = new Date();
    d.toLocaleString();

    log("Started process at " + d, false);

    //load the configuration from the JSON file.
    let loadedConfig = loadConfig(configFileName);
    config = { ...config, ...loadedConfig };

    //get all of the change sets by scraping the page
    if (config.automaticallyFetchChangeSetNames) {
        let changeSetPageContent = await getOutboundChangeSets();
        let changeSetNames = parseChangeSetPageContent(changeSetPageContent);
        writeChangeSetConfigFile(changeSetNames);
    }

    //get the names of all the change sets to download. this currently comes from a hard coded file. Later it may be dynamic.
    log(`Beginning package downloads`);
    let changeSetsToFetchArray = readJSONFromFile(config.changesetJSONFile);

    //fetch the packages/change sets using the sfdx cli
    await fetchChangeSets(changeSetsToFetchArray);
    log("Done fetching change sets");

    //reads the contents of all the packagexml files.
    let packageXmlData = readPackageXML(config.rootFolder);

    //create our basic package XML template to add into.
    var mergedContent = createPackageXmlTemplate();

    log("Finished reading files. Starting merge");

    //merge the contents of all the XML files into our template.
    var mergedData = mergeObjects(packageXmlData, mergedContent);

    //sort the resulting values;
    mergedData = sortValues(mergedData);

    //write the contents of our merged data into files.
    writeFiles(mergedData, "package");

    finish();
}

/**
 * @Description gets the raw HTML content of the change set page in Salesforce so we can scrape out the change set names since no API exists to fetch them natively.
 */
async function getOutboundChangeSets() {
    log("Getting change sets from scraped page content at /changemgmt/listOutboundChangeSet.apexp");

    await runCommand("sfdx", [`force:apex:execute`, `-f getChangeSets.apex`, `>changeSetContent.txt`]);
    log("Fetched change sets.");

    let pageContent = fs.readFileSync("changeSetContent.txt", "utf8", function (err) {
        log("Scraped change set data webpage could not be read." + err.message, true, "yellow");
    });

    //now lets remove all the junk we don't need to make it easier for the parser
    pageContent = pageContent.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); //these damn invisible control characters took me way to long to figure out that they were messing up my searching/dom parsing.
    pageContent = pageContent.toString("utf-8").trim();
    pageContent = pageContent.substring(pageContent.lastIndexOf(startPosition) + 1);
    pageContent = pageContent.split(endPosition)[0];

    return pageContent.trim();
}

/**
 * @Description Parses the raw HTML content fetched by getOutboundChangeSets() to return an array containing all the change set names.
 * @Param html a string of HTML that contains the change set names fetched from the Salesforce UI
 */
function parseChangeSetPageContent(html) {
    log("Parsing change set HTML content to scrape change set names");

    const $ = cheerio.load(html);

    let packageNames = [];
    let packageLinks = $("a");

    $(packageLinks).each(function (i, link) {
        let linkText = $(link).text();
        let linkTarget = $(link).attr("href");

        if (linkTarget && linkTarget.indexOf("changemgmt/outboundChangeSetDetailPage.apexp") > 0 && linkText != "Edit") {
            log(`Found change set with name: ${linkText}`);
            packageNames.push(linkText);
        }
    });

    return packageNames;
}

/**
 * @Description Writes an updated changeSetConfig file using the given names. These entries can be used next time to fetch change sets without having to scrape the UI for the names.
 * @Param changesetNames an array of strings that are names of changesets.
 */
function writeChangeSetConfigFile(changesetNames) {
    fs.writeFileSync(`${config.changesetJSONFile}`, JSON.stringify(changesetNames), function (err) {
        if (err) return log(err);
        log(`Wrote JSON Change Set File to ${config.changesetJSONFile}`);
    });
}

/**
 * @Description Parses the raw HTML content fetched by getOutboundChangeSets() to return an array containing all the change set names.
 * @Param html a string of HTML that contains the change set names fetched from the Salesforce UI
 * @Return
 */
function loadConfig(configFileName) {
    readJSONFromFile(configFileName);
}

/**
 * @Description Creates and returns the empty XML template for the merged package.xml file.
 * @Return a string containing the template of a package.xml file.
 */
function createPackageXmlTemplate() {
    //create our basic package XML template to add into.
    var newPackage;

    //parse the XML into javascript object.
    parseString(packageStructure, function (err, result) {
        newPackage = result;
        newPackage.Package.types = [];
    });

    return newPackage;
}

/**
 * @Description Reads and parses JSON from a given file.
 * @Param fileName the name of the file to read, parse, and return.
 * @Return a JSON object.
 */
function readJSONFromFile(fileName) {
    const changeSetsJsonString = fs.readFileSync(fileName, function (err) {
        log("File not found or unreadable. Skipping import" + err.message, true, "red");
        if (err) throw err;
    });

    const parsedJSON = JSON.parse(changeSetsJsonString);
    return parsedJSON;
}

/**
 * @Description Uses SFDX CLI to download all the given change sets.
 * @Param changeSetName an array of strings that are changeset names.
 * @Return true when all change sets have finished downloading.
 */
async function fetchChangeSets(changeSetNames) {
    for (const changeSetName of changeSetNames) {
        if (config.skipExistingChangeSets && fs.existsSync(`${config.rootFolder}\\${changeSetName}`)) {
            log(`Change set: "${changeSetName}" already exists and skipExistingChangeSets is set to true. Skipping download`);
        } else {
            log(`Fetching: "${changeSetName}"...`);

            await runCommand("sfdx", [`force:mdapi:retrieve`, `-s`, `-r ./${config.rootFolder}`, `-p "${changeSetName}"`, `--unzip`, `--zipfilename "${changeSetName}.zip"`]);
        }
    }

    return true;
}

/**
 * @Description Reads all the package.xml files in direct sub folders of the root folder. Parses the XML into javascript objects, adds all objects into an array then returns it.
 * @Param rootFolder the parent folder in which to scan for downloaded changesets and extract their package.xml
 * @Return an array containing all the package.xml content translated into javascript objects.
 */
function readPackageXML(rootFolder) {
    let filesDataArray = [];

    log(`Beginning reading of package.xml files`);

    packageFolders = getSubFolders(rootFolder);

    log("Got folders: " + packageFolders);

    for (const folderName of packageFolders) {
        log(`Reading package from: ${rootFolder}\\${folderName}\\package.xml`);

        var content = fs.readFileSync(`${rootFolder}\\${folderName}\\package.xml`).toString();

        //parse the read XML into a javascript object.
        parseString(content, function (err, result) {
            if (err) {
                log("Error parsing XML! " + JSON.stringify(err, null, 2), true, "red");
            }
            filesDataArray.push(result);
        });
    }
    return filesDataArray;
}

/**
 * @Description Copies all the contents of all the folders in the rootFolder into the targetFolder. This creates a master/merged package folder that contains all the content of all the other change sets.
 * @Param rootFolder the parent folder in which to copy contents from
 * @Param targetFolder the folder to copy all the folder contents into.
 * @Return true when finished.
 */
function buildMergedPackageFolder(rootFolder, targetFolder) {
    log(`Building merged package into folder... ${rootFolder}\\${targetFolder}`);

    packageFolders = getSubFolders(rootFolder);

    for (const folderName of packageFolders) {
        //skip copying the contents of the target folder into itself.
        if (folderName == targetFolder) continue;

        log(`Reading package from: ${rootFolder}\\${folderName}`);

        copyRecursiveSync(`${rootFolder}\\${folderName}`, `${rootFolder}\\${targetFolder}`);
    }

    return true;
}

/**
 * @Description Copies Copies all contents of a source folder into a destination folder.
 * @Param src path of source folder to copy all contents from.
 * @Param dest path of destination folder to put all copied contents into.
 * @Return true when finished.
 */
function copyRecursiveSync(src, dest) {
    var exists = fs.existsSync(src);
    var stats = exists && fs.statSync(src);
    var isDirectory = exists && stats.isDirectory();

    if (isDirectory) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest);
        fs.readdirSync(src).forEach(function (childItemName) {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }

    return true;
}

/**
 * @Description Gets all the folders in the given root folder.
 * @Param root folder to find all subdirectories of.
 * @Return array of strings containing direct sub folder names.
 */
function getSubFolders(rootFolder) {
    return fs.readdirSync(rootFolder).filter(function (file) {
        return fs.statSync(rootFolder + "/" + file).isDirectory();
    });
}

/**
 * @Description Merges together an array of package.xml files (as strings) into one javascript object containing all the data of all the provided elements.
 * @Param filesDataArray an array of strings that represent package.xml files to merge together.
 * @Param packageObject the object to merge the packages into.
 * @Return a single javascript object that contains all the keys/values of the objects provided inthe filesDataArray
 */
function mergeObjects(filesDataArray, packageObject) {
    filesDataArray.forEach(function (thisFile, index) {
        if (!packageObject) packageObject = {};
        if (thisFile && thisFile.hasOwnProperty("Package") && thisFile.Package.hasOwnProperty("types")) {
            thisFile.Package.types.forEach(function (thisType, index2) {
                log("Writing " + thisType.members.length + " members to " + thisType.name);
                packageObject = appendTypesToPackage(String(thisType.name), thisType.members, packageObject);
            });
        } else {
            log("Malfomred or empty packaged file: " + index, true, "red");
        }
    });

    return packageObject;
}

/**
 * @Description Writes the resulting files from the given objectData. This creates a package.xml, a package.json, and a package.csv that contain provided data. Additionally if createMergedPackage is true in the config
 * this will create the mergedPackage folder, populate it with all contents and write the merged package.xml file into the newly created folder so it is deployable.
 * @Param objectData a javascript object that contains all the properties and values needed to create a package.xml file and its related files. This should be generated by the mergeObjects() functions.
 * @Param filename the name to use for all the generated files. This should pretty much always be 'package'.
 */
function writeFiles(objectData, filename) {
    objectData.Package.types = objectData.Package.types.sort((a, b) => (a.name > b.name ? 1 : -1));
    if (config.forcePackageVersion != null) {
        objectData.Package.version = config.forcePackageVersion;
    }
    log("Writing new package.xml...");

    let configAsJson = JSON.stringify(objectData, undefined, 2);
    let builder = new xml2js.Builder();
    let xml = builder.buildObject(objectData);

    if (!fs.existsSync(config.outputFolder)) fs.mkdirSync(config.outputFolder);

    //write the contents as JSON
    fs.writeFileSync(`${config.outputFolder}\\${filename}.json`, configAsJson, function (err) {
        if (err) return log(err);
        log("The JSON file was created!");
    });

    //write the contents as XML
    fs.writeFileSync(`${config.outputFolder}\\${filename}.xml`, xml, function (err) {
        if (err) return log(err);
        log("The XML file was created");
    });

    //write the contents as XML
    fs.writeFileSync(`${config.outputFolder}\\${filename}.csv`, jsonToCSV(objectData), function (err) {
        if (err) return log(err);
        log("The XML file was created");
    });

    if (config.createMergedPackage) {
        //copy all files from all the package folders into our merged package folder
        buildMergedPackageFolder(config.rootFolder, config.mergedPackageFolder);

        //write our merged package xml into that folder as well.
        fs.writeFileSync(`${config.rootFolder}\\${config.mergedPackageFolder}\\package.xml`, xml, function (err) {
            if (err) return log(err);
            log("The merged xml package file was created!");
        });
    }
}

/**
 * @Description Converts a JSON object that represents a package.xml file into a CSV formatted string that can then be written to a file. Each 'type' will be a column header and each 'member' will be a row.
 * this will create the mergedPackage folder, populate it with all contents and write the merged package.xml file into the newly created folder so it is deployable.
 * @Param packageAsJsonObject a JSON object created from a package.xml file.
 * @Return a string representing a CSV file with all the contents of the provided packageAsJsonObject
 */
function jsonToCSV(packageAsJsonObject) {
    let csvString = "";
    let colValues = [];
    let rows = [];
    let rowLimit = 0;
    //create the header row
    for (const index in packageAsJsonObject.Package.types) {
        csvString += packageAsJsonObject.Package.types[index].name + ",";
        colValues.push(packageAsJsonObject.Package.types[index].members);
        if (packageAsJsonObject.Package.types[index].members.length > rowLimit) rowLimit = packageAsJsonObject.Package.types[index].members.length;
    }
    csvString += "\r\n";
    for (let index = 0; index < rowLimit; index++) {
        let row = "";
        for (col in colValues) {
            if (colValues[col][index]) row += colValues[col][index] + ",";
            else row += '"",';
        }
        row += "\r\n";
        csvString += row;
    }

    return csvString;
}

/**
 * @Description Merges the 'members' elements of the 'types' properties of a given package object. Used by the mergePacakge function to combine package contents together.
 * @Param typeName the name of the 'type' property to merge. Such as ApexTrigger or CustomField, etc.
 * @Param the new list of 'member' entries to merge into the package object.
 * @Param packageObject the merged package into which these new members should be merged.
 * @Param modified packageObject with new unique members merged into the propert type.
 */
function appendTypesToPackage(typeName, members, packageObject) {
    //ensure the incoming package object has the types property. If not, initialize it
    if (!packageObject.Package.hasOwnProperty("types")) packageObject.Package.types = [];
    let matchFound = false;

    //iterate over every type in our package object.
    packageObject.Package.types.forEach(function (thisType, index2) {
        let thisTypeName = String(thisType.name);

        //if the currently iterated type matches the one provided in the function all, then we want to set the members property to an array of those two array merged together and de-duplicated.
        if (thisTypeName == typeName) {
            thisType.members = getUnique(thisType.members.concat(members));
            matchFound = true;
            return packageObject;
        }
    });

    if (!matchFound) {
        let dataObject = { name: typeName, members: getUnique(members) };
        packageObject.Package.types.push(dataObject);
    }

    return packageObject;
}

/**
 * @Description Deduplicates an array to only provide unqiue elements.
 * @Param array an array to de-duplicate
 * @Return Array with duplicate values removed.
 */
function getUnique(array) {
    var uniqueArray = [];

    // Loop through array values
    for (i = 0; i < array.length; i++) {
        if (uniqueArray.indexOf(array[i]) === -1) {
            uniqueArray.push(array[i]);
        }
    }
    return uniqueArray;
}

/**
 * @Description Sorts all the member values of the types properties of the package object.
 * @Param packageObject a javascript object that represents a package.xml file
 * @Return javascript object with the members array of each types entry sorted.
 */
function sortValues(packageObject) {
    packageObject.Package.types.forEach(function (thisType, index2) {
        thisType.members.sort();
    });

    return packageObject;
}

/**
 * @Description Runs a shell command.
 * @Param command the name of the command to execute WITHOUT any arguments.
 * @Param arguments an array of arguments to pass to the command.
 * @Return javascript promise object that contains the result of the command execution
 */
function runCommand(command, arguments) {
    let p = spawn(command, arguments, { shell: true, windowsVerbatimArguments: true });
    return new Promise((resolveFunc) => {
        p.stdout.on("data", (x) => {
            process.stdout.write(x.toString());
            log(x.toString());
        });
        p.stderr.on("data", (x) => {
            process.stderr.write(x.toString());
            log(x.toString());
        });
        p.on("exit", (code) => {
            resolveFunc(code);
        });
    });
}

/**
 * @Description Creates a log entry in the log file, and optionally displays log entry to the terminal window with requested color.
 * @Param logItem a string of data to log
 * @Param printToScreen boolean flag indicating if this entry should be printed to the screen (true) or only to the log file (false)
 * @Param a string {'red','green','yellow'} that indicates what color the logItem should be printed in on the screen..
 */
function log(logItem, printToScreen, color) {
    printToScreen = printToScreen != null ? printToScreen : true;
    var colorCode = "";
    switch (color) {
        case "red":
            colorCode = "\x1b[31m";
            break;
        case "green":
            colorCode = "\x1b[32m";
            break;
        case "yellow":
            colorCode = "\x1b[33m";
    }

    if (printToScreen) console.log(colorCode + "" + logItem + "\x1b[0m");

    fs.appendFile("log.txt", logItem + "\r\n", function (err) {
        if (err) throw err;
    });
}

/**
 * @Description Method that executes at the end of a successful script run. Exits the program.
 */
function finish() {
    log("Process completed", true, "yellow");
    log("\r\n\r\n------------------------------------------------ ", false);
    process.exit(1);
}

/**
 * @Description Method that executes on an uncaught error.
 */
process.on("uncaughtException", (err) => {
    log(err, true, "red");
    process.exit(1); //mandatory (as per the Node docs)
});

init();
