"use strict";
const moment = require("moment-timezone");
moment.locale("fr");
const { generateursPDF } = require("../../utils/generatePDF");
const ValidationError = require("../../utils/errors/ValidationError");
const { treeTraversal } = require("../../utils/treeTraversal");

const {
    RATE_CONVERSION_MILLISECONDS_TO_SECONDS,
    RATE_CONVERSION_SECONDS_TO_MINUTES,
    RATE_CONVERSION_SECONDS_TO_HOURS
} = require("../../../repositories/exportRepository/constantes");

const pdfNameGeneratorFunction = (date, fuseauHoraire, sub) => {
    return `${moment
        .tz(date, fuseauHoraire)
        .format("YYYYMMDDHHmmss")}_registre_pour_${sub}.pdf`;
};

module.exports = ({
    repositories,
    pdf,
    pdfNameGenerator = pdfNameGeneratorFunction
}) => async ({ payload, transaction }) => {
    const {
        activiteRepository,
        configRepository,
        evenementRepository,
        exportRepository,
        mentionDeServiceRepository,
        priseDeServiceRepository,
        serviceRepository
    } = repositories;
    const query = payload.query;
    const { fuseauHoraire, plageHoraire } = query;
    const { premierNoeudTague, sub } = payload.context.user;

    const {
        limite_fiches: limiteFiches,
        delai_retry: retryDelay,
        limite_plage_horaire: limitePeriode
    } = await configRepository.getExport({ type: "registre" });

    if (!plageHoraire) {
        throw new ValidationError(
            "Le payload ne contient pas de champ plageHoraire (format: doublon de dates séparées par une virgule)"
        );
    }
    if (!fuseauHoraire) {
        throw new ValidationError(
            "Le payload ne contient pas de champ fuseauHoraire (ex: 'Europe/Paris')"
        );
    }

    const periode = {
        dateDebut: new Date(plageHoraire.split(",")[0]),
        dateFin: new Date(plageHoraire.split(",")[1])
    };
    const diffInSeconds =
        Math.abs(periode.dateFin - periode.dateDebut) /
        RATE_CONVERSION_MILLISECONDS_TO_SECONDS;

    if (diffInSeconds > limitePeriode) {
        throw new ValidationError(
            `Vous ne pouvez pas exporter le registre avec une plage de dates supérieure à ${Math.ceil(
                limitePeriode / RATE_CONVERSION_SECONDS_TO_HOURS
            )} heures`
        );
    }

    const demandeExport = await exportRepository.insertNewDemand({
        sub,
        delai_retry: retryDelay,
        transaction
    });
    if (!demandeExport) {
        throw new ValidationError(
            `Un registre est déjà en cours de téléchargement, ou une demande d'export a déjà été effectuée il y a moins de ${Math.ceil(
                retryDelay / RATE_CONVERSION_SECONDS_TO_MINUTES
            )} minutes`
        );
    }

    const noeudService = await serviceRepository.loadServiceSubTree(
        premierNoeudTague,
        { transaction }
    );

    const tousLesServices = treeTraversal(noeudService, "subServices", [
        "id",
        "serviceRpsiId",
        "libelle",
        "abreviation",
        "serviceHierarchie"
    ]);

    const evenements = await evenementRepository.getAllForExport({
        options: { ...query },
        uniteIds: tousLesServices.map(service => service.serviceRpsiId),
        periode
});
    evenements.data.sort(
        (a, b) => a.dateConnaissanceFaits - b.dateConnaissanceFaits
);

    const mentions = await mentionDeServiceRepository.getAllForExport({
        options: { ...query },
        uniteIds: tousLesServices.map(service => service.id),
        periode
});
    mentions.data.sort((a, b) => a.dateCreation - b.dateCreation);

    const prisesDeServices = await priseDeServiceRepository.getAllForExport({
        options: { ...query },
        uniteIds: tousLesServices.map(service => service.id),
        periode
});
    prisesDeServices.data.sort((a, b) =>
    a.dateDebut - b.dateDebut === 0
        ? a.dateFin - b.dateFin
        : a.dateDebut - b.dateDebut
);

    const compteurFiches =
        evenements.data.length +
        mentions.data.length +
        prisesDeServices.data.length;

    if (compteurFiches > limiteFiches) {
        throw new ValidationError(
            `Le registre est trop volumineux pour être téléchargé : ${compteurFiches} fiches demandées pour un maximum de ${limiteFiches}`
        );
    }

    const printer = pdf.getPrinter();
    const documentDefinition = pdf.getDefaultPage({
        fuseauHoraire: fuseauHoraire,
        numero: "",
        servicePath: ""
    });
    documentDefinition.content = [
        await generateursPDF.contentRegistre(
            { evenements, mentions, prisesDeServices },
            tousLesServices,
            activiteRepository
        )
    ];
    return {
        document: printer.createPdfKitDocument(documentDefinition),
        nom: pdfNameGenerator(new Date(), fuseauHoraire, sub)
    };
};
