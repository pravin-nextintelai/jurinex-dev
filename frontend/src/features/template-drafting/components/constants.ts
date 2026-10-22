export interface UniversalSection {
    id: string; // e.g., 'document_information', 'parties'
    title: string;
    description: string;
    defaultPrompt: string;
    subItems: string[]; // e.g., 'Document Title', 'Document Type'
}

export interface SectionCustomization {
    sectionId: string;
    customPrompt?: string;
    isDeleted: boolean; // Virtual deletion (hidden from final draft)
}

export const UNIVERSAL_SECTIONS: UniversalSection[] = [
    {
        id: 'document_information',
        title: '1. Document Information',
        description: 'Basic details about the document.',
        subItems: ['Document Title', 'Document Type', 'Category', 'Jurisdiction', 'Language', 'Date of Execution', 'Effective Date'],
        defaultPrompt: 'Generate a Document Information section stating the Document Title, Type, Category, Jurisdiction, Language, Date of Execution, and Effective Date.'
    },
    {
        id: 'parties',
        title: '2. Parties',
        description: 'Identification of the parties involved.',
        subItems: ['First Party', 'Second Party', 'Additional Parties', 'Legal Status', 'Address', 'Authorized Signatory'],
        defaultPrompt: 'Draft the Parties section identifying the First Party and Second Party, including their Legal Status, Address, and Authorized Signatories. Include provisions for Additional Parties if applicable.'
    },
    {
        id: 'background_recitals',
        title: '3. Background / Recitals',
        description: 'Context and purpose of the agreement.',
        subItems: ['Purpose of Agreement', 'Business Context', 'Intent of Parties'],
        defaultPrompt: 'Write the Background/Recitals section explaining the Purpose of Agreement, Business Context, and the Intent of the Parties.'
    },
    {
        id: 'definitions_interpretation',
        title: '4. Definitions & Interpretation',
        description: 'Key terms and how to interpret the document.',
        subItems: ['Definitions', 'Interpretation Rules'],
        defaultPrompt: 'Create a Definitions & Interpretation section defining key terms used in the document and outlining the Interpretation Rules.'
    },
    {
        id: 'subject_matter',
        title: '5. Subject Matter',
        description: 'The core topic of the agreement.',
        subItems: ['What is being agreed', 'Description of property / service / relationship'],
        defaultPrompt: 'Draft the Subject Matter section detailing exactly what is being agreed upon, including a description of the property, service, or relationship.'
    },
    {
        id: 'scope_rights_obligations',
        title: '6. Scope of Rights & Obligations',
        description: 'Duties and rights of each party.',
        subItems: ['Rights of Party A', 'Rights of Party B', 'Duties & Responsibilities'],
        defaultPrompt: 'Outline the Scope of Rights & Obligations, specifying the Rights of Party A, Rights of Party B, and their respective Duties & Responsibilities.'
    },
    {
        id: 'term_duration',
        title: '7. Term & Duration',
        description: 'How long the agreement lasts.',
        subItems: ['Start Date', 'End Date', 'Renewal', 'Survival'],
        defaultPrompt: 'Draft the Term & Duration section including the Start Date, End Date, Renewal conditions, and any Survival clauses.'
    },
    {
        id: 'commercial_terms',
        title: '8. Commercial Terms',
        description: 'Financial aspects of the agreement.',
        subItems: ['Consideration', 'Payment Amount', 'Payment Method', 'Taxes', 'Penalties'],
        defaultPrompt: 'Write the Commercial Terms section covering Consideration, Payment Amount, Payment Method, Taxes, and any applicable Penalties.'
    },
    {
        id: 'representations_warranties',
        title: '9. Representations & Warranties',
        description: 'Attributes the parties guarantee to be true.',
        subItems: ['Legal Authority', 'Compliance', 'Ownership', 'No Conflict'],
        defaultPrompt: 'Draft the Representations & Warranties section, affirming Legal Authority, Compliance, Ownership, and ensuring No Conflict.'
    },
    {
        id: 'confidentiality_data_protection',
        title: '10. Confidentiality & Data Protection',
        description: 'Handling of private information.',
        subItems: ['Confidentiality', 'Data Usage', 'Privacy'],
        defaultPrompt: 'Create a Confidentiality & Data Protection section detailing obligations regarding Confidentiality, Data Usage, and Privacy.'
    },
    {
        id: 'intellectual_property',
        title: '11. Intellectual Property',
        description: 'Ownership and usage of IP.',
        subItems: ['IP Ownership', 'License', 'Restrictions'],
        defaultPrompt: 'Draft the Intellectual Property section specifying IP Ownership, License grants, and Restrictions.'
    },
    {
        id: 'indemnity_liability',
        title: '12. Indemnity & Liability',
        description: 'Protection against loss and limits on liability.',
        subItems: ['Indemnity', 'Limitation of Liability'],
        defaultPrompt: 'Write the Indemnity & Liability section, including Indemnity clauses and Limitation of Liability provisions.'
    },
    {
        id: 'termination',
        title: '13. Termination',
        description: 'How the agreement ends.',
        subItems: ['Termination Events', 'Notice Period', 'Effect of Termination'],
        defaultPrompt: 'Draft the Termination section outlining Termination Events, the required Notice Period, and the Effect of Termination.'
    },
    {
        id: 'force_majeure',
        title: '14. Force Majeure',
        description: 'Unforeseeable circumstances.',
        subItems: [],
        defaultPrompt: 'Create a Force Majeure clause defining events beyond control that excuse performance.'
    },
    {
        id: 'dispute_resolution',
        title: '15. Dispute Resolution',
        description: 'How disputes are settled.',
        subItems: ['Governing Law', 'Jurisdiction', 'Arbitration'],
        defaultPrompt: 'Draft the Dispute Resolution section specifying Governing Law, Jurisdiction, and Arbitration procedures.'
    },
    {
        id: 'compliance_legal',
        title: '16. Compliance & Legal',
        description: 'Adherence to laws.',
        subItems: ['Applicable Laws', 'Regulatory Compliance'],
        defaultPrompt: 'Write the Compliance & Legal section regarding Applicable Laws and Regulatory Compliance.'
    },
    {
        id: 'assignment_transfer',
        title: '17. Assignment & Transfer',
        description: 'Transferring rights/obligations.',
        subItems: [],
        defaultPrompt: 'Draft the Assignment & Transfer section detailing conditions for assigning or transferring rights and obligations.'
    },
    {
        id: 'notices',
        title: '18. Notices',
        description: 'Communication protocols.',
        subItems: [],
        defaultPrompt: 'Create a Notices section specifying valid methods and addresses for official communications.'
    },
    {
        id: 'amendments_waivers',
        title: '19. Amendments & Waivers',
        description: 'Changing document terms.',
        subItems: [],
        defaultPrompt: 'Draft the Amendments & Waivers section establishing how changes to the agreement must be made.'
    },
    {
        id: 'general_clauses',
        title: '20. General Clauses',
        description: 'Miscellaneous legal provisions.',
        subItems: ['Severability', 'Entire Agreement', 'Relationship of Parties'],
        defaultPrompt: 'Write the General Clauses section including Severability, Entire Agreement, and Relationship of Parties.'
    },
    {
        id: 'special_terms',
        title: '21. Special Terms',
        description: 'Template-specific clauses.',
        subItems: ['(Template-specific clauses go here)'],
        defaultPrompt: 'Draft any Special Terms unique to this specific template or agreement.'
    },
    {
        id: 'schedules_annexures',
        title: '22. Schedules & Annexures',
        description: 'Attachments.',
        subItems: [],
        defaultPrompt: 'List Schedules & Annexures attached to this agreement.'
    },
    {
        id: 'signatures',
        title: '23. Signatures',
        description: 'Signing area.',
        subItems: ['Party Signatures', 'Witnesses', 'Date & Place'],
        defaultPrompt: 'Generate a structured signature area in HTML table format with placeholders for signatures of the First Party and Second Party. Include lines for Name, Title, and Date. Also include space for two Witnesses with Name and Address lines. Ensure clear separation and professional formatting.'
    }
];
