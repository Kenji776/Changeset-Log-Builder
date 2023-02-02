What is this?

This is a node.js application that is used for assisting with Salesforce devops. It's purpose is to allow for easy downloading of change sets and record their contents, along with merging them together to create a 'merged' change set that contains all of the other ones. This exists because when working on a Salesforce project where some of contributors are unfamiliar with SFDX/Source control it can be difficult to integrate their work into the source control repo. The idea with this is that the contributors can simply create a change set within Salesforce and this script can pull down their changes and record all of their modifications in an organized way that makes it easy to then add and commit their work into the source repo. When this script is run it can either automatically get all change sets by scraping the change set UI page, or it can be given a discrete list of change sets to download ([config.automaticallyFetchChangeSetNames] true/false). Once the names of the change sets are defined the script will then download them all using the SFDX CLI utilities. After all the change sets have been downloaded, three files are created, package.xml, package.json, and package.csv. The package.xml is a manifest that can be used to deploy all the content from all the change sets. The package.json file is just a different notation of the same data that currently doesn't have a direct use I'm aware of but I figured why not. The package.csv a file that again contains all the contents from all the packages in a more human readable way that can be delivered at the end of a project, or to help keep track of everything that's been modified. Finally the script can optionally create a 'merged' folder that contains all the contents of all the packages. This paired with the merged package.xml file allows you to easily deploy all contents of all the change sets in one operation in the case of setting up a new sandbox or you need to push everything all at once for some reason.

How to use?

1) Make sure you have node.js installed
2) Ensure your SFDX project is setup and connected to your org.
3) Set any desired configuration properties in the config.json file (described below).
4) Optionally provide a JSON array of change set names in the changeSetNames.json file (if [config.automaticallyFetchChangeSetNames] is set to false)
5) Copy this folder into the scripts folder of your SFDX project.
6) Run the changeLogBuilder.js file by either:
 A) Run the batch file (windows machines only)
 b) Use a command prompt to navigate to the folder and enter: "node changeLogBuilder.js" (no quotes).
7) Let the script complete.
8) View the produced output in the [config.outputFolder] folder and the [config.mergedPackageFolder] folder

Config.json properties

skipExistingChangeSets
-description: Should previously downloaded change sets (matching on folder name/change set name) be skipped when downloading?
-default value: true

rootFolder 
-description: the sub folder in which to download the change sets into. Should be a legal OS folder name.
-default value: 'packages',

forcePackageVersion 
-description: The API version to use when generating the new package.xml file
-default value: 50

automaticallyFetchChangeSetNames
-description: Should the script attempt to scrape the names of all change sets from the Salesforce UI? If false, you need to provide them manually in the [config.changesetJSONFile]
-default value: true

changesetJSONFile 
-description: The name of the file to get read change sets from. This will be automatically populated if [config.automaticallyFetchChangeSetNames] is set to true.
-default value: changeSetNames.json

createMergedPackage 
-description: Should the script create a merged package that contains the contents of all the other packages?
-default value: true

mergedPackageFolder 
-description: The name of the folder to write the merged package contents into if [config.createMergedPackage] is set to true.
-default value: __mergedPackage

username
-description: Reserved for future use. Does not currently do anything. Will eventually allow the script to be run outside of an SFDX project folder by providing a configured username.
-default value: null

outputFolder 
-description: The folder in which to write the xml, csv, and JSON files into.
-default value: results